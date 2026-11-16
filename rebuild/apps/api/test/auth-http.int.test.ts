import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { afterEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
describe('real authentication HTTP boundary', () => {
  it('allows a fresh password proof to replace an expired browser session', async () => {
    h = await createTestApp();
    const server = h.app.getHttpServer();
    const result = { body: await new PasswordAuthService(h.db).register({ username: 'expired_browser', password: 'A New Proof Password 72!' }, 'expired') };
    await h.db
      .updateTable('sessions')
      .set({ expires_at: new Date(0) })
      .execute();
    const login = await request(server)
      .post('/api/v1/auth/login')
      .set('Authorization', 'Bearer ' + result.body.token)
      .send({ username: 'expired_browser', password: 'A New Proof Password 72!' })
      .expect(201);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + login.body.token)
      .expect(200);
  });
  it('refuses unverified WeChat identities and honestly reports an unconfigured channel', async () => {
    h = await createTestApp();
    const server = h.app.getHttpServer();
    await request(server)
      .post('/api/v1/auth/wechat/mini')
      .send({ code: 'not-real', openid: 'forged' })
      .expect(400);
    const disabled = await request(server)
      .post('/api/v1/auth/wechat/mini')
      .send({ code: 'not-real' })
      .expect(503);
    expect(disabled.body.message).toBe('LOGIN_CHANNEL_UNAVAILABLE');
    await request(server)
      .get('/api/v1/auth/me')
      .set('x-wx-openid', 'forged')
      .set('x-wx-appid', 'forged')
      .expect(401);
  });
  it('creates a guest but never accepts role fields from registration', async () => {
    h = await createTestApp();
    const server = h.app.getHttpServer();
    const guest = await request(server).post('/api/v1/auth/guest').send({});
    expect(guest.status).toBe(201);
    expect(guest.body.actor.kind).toBe('guest');
    const escalation = await request(server)
      .post('/api/v1/auth/register')
      .send({ username: 'unsafe', password: 'Valid Password 22!', platformRoles: ['owner'] });
    expect(escalation.status).toBe(400);
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + guest.body.token);
    expect(me.status).toBe(200);
    expect(me.body.platformRoles).toEqual([]);
  });
  it('requires verified email registration and invalidates the session on logout', async () => {
    h = await createTestApp();
    const server = h.app.getHttpServer();
    await request(server).post('/api/v1/auth/register').send({ username: 'http_user', password: 'A Real Password 55!' }).expect(400);
    const result = { body: await new PasswordAuthService(h.db).register({ username: 'http_user', password: 'A Real Password 55!' }, 'http') };
    const logout = await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer ' + result.body.token)
      .send({});
    expect(logout.status).toBe(201);
    expect(
      (
        await request(server)
          .get('/api/v1/auth/me')
          .set('Authorization', 'Bearer ' + result.body.token)
      ).status,
    ).toBe(401);
  });
  it('reports malformed usernames as input errors instead of internal server errors', async () => {
    h = await createTestApp();
    const server = h.app.getHttpServer();
    for (const action of ['register', 'login']) {
      const response = await request(server)
        .post('/api/v1/auth/' + action)
        .send({ username: 'bad name!', password: 'A Valid Password 22!' });
      expect(response.status).toBe(400);
    }
  });
});
