import { afterEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app.js';
import type { OtpMessage } from '../src/modules/identity/otp-sender.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
describe('public OTP endpoint boundary', () => {
  it('reports disabled delivery honestly and never accepts a caller supplied account or role', async () => {
    h = await createTestApp();
    const server = h.app.getHttpServer();
    const payload = { channel: 'email', recipient: 'reader@example.com' };
    await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ ...payload, userId: 'somebody-else' })
      .expect(400);
    await request(server).post('/api/v1/auth/otp/request').send(payload).expect(503);
    expect(await h.db.selectFrom('otp_challenges').selectAll().execute()).toEqual([]);
    await request(server)
      .post('/api/v1/auth/otp/login')
      .send({ challengeId: 'bad', code: '123456' })
      .expect(400);
  });
  it('sends through its injected test transport, but never exposes a verification code in HTTP', async () => {
    const messages: OtpMessage[] = [];
    h = await createTestApp(
      {
        otp: {
          policy: { hashKey: 'a'.repeat(64), dailyLimits: { email: 200, sms: 20 } },
          email: {
            host: 'smtp.example.com',
            port: 587,
            security: 'starttls',
            user: 'sender',
            password: 'test-secret',
            from: 'sender@example.com',
          },
        },
      },
      {
        email: {
          send: async (message) => {
            messages.push(message);
          },
        },
      },
    );
    const server = h.app.getHttpServer();
    const guest = await request(server).post('/api/v1/auth/guest').send({}).expect(201);
    const issued = await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ channel: 'email', recipient: 'reader@example.com', purpose: 'register' })
      .expect(201);
    expect(Object.keys(issued.body).sort()).toEqual(
      ['challengeId', 'expiresAt', 'resendAfterSeconds'].sort(),
    );
    const limited = await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ channel: 'email', recipient: 'reader@example.com' })
      .expect(429);
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(messages).toHaveLength(1);
    const result = await request(server)
      .post('/api/v1/auth/otp/register')
      .set('Authorization', 'Bearer ' + guest.body.token)
      .send({ challengeId: issued.body.challengeId, code: messages[0]!.code, username: 'http_registered', password: 'Verified Password 19!' })
      .expect(201);
    expect(result.body.actor.userId).toBe(guest.body.actor.userId);
    expect(result.body.actor.kind).toBe('member');
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + guest.body.token)
      .expect(401);
    const channels = await request(server).get('/api/v1/auth/channels').expect(200);
    expect(channels.body.email).toBe(true);
    expect(channels.body.sms).toBe(false);
  });
});
