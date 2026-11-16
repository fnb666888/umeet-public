import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { OtpService } from '../src/modules/identity/otp.service.js';
import type { OtpMessage } from '../src/modules/identity/otp-sender.js';

it('enforces participation writes and preserves email reauthentication for deactivated accounts', async () => {
  const h = await createTestApp();
  try {
    const auth = new PasswordAuthService(h.db);
    const admin = await auth.register(
      { username: 'access_admin', password: 'Disposition tests 923!' },
      'access-admin',
    );
    const author = await auth.register(
      { username: 'access_author', password: 'Disposition tests 923!' },
      'access-author',
    );
    const peer = await auth.register(
      { username: 'access_peer', password: 'Disposition tests 923!' },
      'access-peer',
    );
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin.actor.userId, role: 'admin' })
      .execute();
    await h.db
      .insertInto('external_identities')
      .values({ provider: 'email', subject: 'access@example.edu', user_id: author.actor.userId })
      .execute();
    const client = request(h.app.getHttpServer());
    const send = (operations: object[]) =>
      client
        .post('/api/v1/demo/operations')
        .auth(author.token, { type: 'bearer' })
        .send({ id: randomUUID(), operations });
    await send([
      {
        type: 'post.create',
        post: { id: 'access-post', title: '访问限制测试', body: '正文', community: 'daily' },
      },
      { type: 'reply.create', postId: 'access-post', reply: { id: 'access-reply', body: '回复' } },
    ]).expect(201);
    const actionId = randomUUID();
    await client
      .post('/api/v1/admin/community/actions')
      .auth(admin.token, { type: 'bearer' })
      .send({
        id: actionId,
        action: 'disposition',
        target: author.actor.userId,
        disposition: { kind: 'participation', scope: 'global', hours: 24, expectedVersion: null },
        reason: '验证参与限制',
      })
      .expect(201);
    for (const operation of [
      { type: 'post.edit', postId: 'access-post', title: '编辑', body: '编辑正文' },
      { type: 'reply.edit', postId: 'access-post', replyId: 'access-reply', body: '编辑回复' },
      { type: 'post.vote', postId: 'access-post', value: true },
      { type: 'reply.vote', postId: 'access-post', replyId: 'access-reply', value: true },
      { type: 'message.send', id: 'blocked-message', peer: peer.actor.userId, text: '私信' },
    ])
      await send([operation]).expect(403);
    await send([
      { type: 'profile.save', profile: { name: 'access_author', bio: '仍可维护个人资料' } },
    ]).expect(201);
    await client
      .post('/api/v1/messages/' + peer.actor.userId + '/send')
      .auth(author.token, { type: 'bearer' })
      .send({ id: randomUUID(), text: '独立私信入口' })
      .expect(403);
    await client.get('/api/v1/demo').auth(author.token, { type: 'bearer' }).expect(200);
    await client
      .post('/api/v1/admin/community/actions')
      .auth(admin.token, { type: 'bearer' })
      .send({
        id: randomUUID(),
        action: 'disposition',
        target: author.actor.userId,
        disposition: { kind: 'deactivation', scope: 'global', hours: 24, expectedVersion: null },
        reason: '验证受控安全入口',
      })
      .expect(201);
    const messages: OtpMessage[] = [];
    const otp = new OtpService(
      h.db,
      { hashKey: 'a'.repeat(64), dailyLimits: { email: 200, sms: 20 } },
      {
        email: {
          send: async (message) => {
            messages.push(message);
          },
        },
      },
    );
    const challenge = await otp.request('email', 'access@example.edu', 'reauth', author.token);
    await otp.verifyReauthentication(
      { challengeId: challenge.challengeId, code: messages.at(-1)!.code },
      author.token,
    );
    await client
      .post('/api/v1/account/revoke')
      .auth(author.token, { type: 'bearer' })
      .send({ id: 'others' })
      .expect(201);
    await expect(otp.request('email', 'other@example.edu', 'link', author.token)).rejects.toThrow();
    const status = await client
      .get('/api/v1/governance')
      .auth(author.token, { type: 'bearer' })
      .expect(200);
    expect(status.body.suspended).toBe(true);
    expect(status.body.actions).toHaveLength(2);
  } finally {
    await h.close();
  }
});
