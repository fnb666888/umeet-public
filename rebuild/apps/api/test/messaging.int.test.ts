import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { up } from '../src/database/migrations/018_messaging.js';
import { conversationId } from '../src/modules/messaging/messaging.service.js';

it('handles requests, message retries, read boundaries, privacy and old conversations', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const users = [];
    for (const username of ['dm_alpha', 'dm_beta', 'dm_third'])
      users.push(
        await new PasswordAuthService(h.db).register(
          { username, password: 'Message test 239!' },
          username,
        ),
      );
    const [a, b, c] = [users[0]!, users[1]!, users[2]!];
    const get = (who: typeof a, path = '') =>
      client.get('/api/v1/messages' + path).auth(who.token, { type: 'bearer' });
    const send = (who: typeof a, peer: string, text: string, id = randomUUID()) =>
      client
        .post('/api/v1/messages/' + peer + '/send')
        .auth(who.token, { type: 'bearer' })
        .send({ id, text });
    const action = (who: typeof a, peer: string, body: object) =>
      client
        .post('/api/v1/messages/' + peer + '/action')
        .auth(who.token, { type: 'bearer' })
        .send(body);
    await client.get('/api/v1/messages').expect(401);
    expect((await get(a).expect(200)).body.conversations).toEqual([]);
    const first = randomUUID();
    await Promise.all([
      send(a, b.actor.userId, '初次联系', first).expect(201),
      send(a, b.actor.userId, '初次联系', first).expect(201),
    ]);
    expect((await get(b, '?view=requests')).body.requests).toBe(1);
    expect((await get(b, '?view=requests')).body.conversations[0].incomingRequest).toBe(true);
    expect((await get(c)).body.conversations).toEqual([]);
    expect((await get(c, '/' + a.actor.userId)).body.messages).toEqual([]);
    await action(c, a.actor.userId, { action: 'block', value: true }).expect(201);
    await action(c, a.actor.userId, { action: 'block', value: false }).expect(201);
    expect((await get(c, '/' + a.actor.userId)).body.conversation.status).toBe('new');
    await action(a, c.actor.userId, { action: 'accept' }).expect(400);
    await send(a, b.actor.userId, '继续打扰').expect(403);
    await send(a, b.actor.userId, '冲突内容', first).expect(409);
    await action(a, b.actor.userId, { action: 'accept' }).expect(400);
    await action(b, a.actor.userId, { action: 'accept' }).expect(201);
    const second = (await send(a, b.actor.userId, '接受后可继续').expect(201)).body;
    await action(b, a.actor.userId, { action: 'read', messageId: first }).expect(201);
    expect((await get(b)).body.unread).toBe(1);
    await action(c, a.actor.userId, { action: 'read', messageId: second.id }).expect(400);
    await action(b, a.actor.userId, { action: 'mute', value: true }).expect(201);
    expect((await get(b)).body.unread).toBe(0);
    expect((await get(b)).body.conversations[0].unread).toBe(1);
    await action(b, a.actor.userId, { action: 'hide' }).expect(201);
    expect((await get(b)).body.conversations).toHaveLength(0);
    await send(a, b.actor.userId, '重新出现').expect(201);
    expect((await get(b)).body.conversations).toHaveLength(1);
    await action(b, a.actor.userId, { action: 'block', value: true }).expect(201);
    await send(a, b.actor.userId, '被拉黑').expect(403);
    await client
      .post('/api/v1/demo/operations')
      .auth(a.token, { type: 'bearer' })
      .send({
        id: randomUUID(),
        operations: [
          { type: 'message.send', id: randomUUID(), peer: b.actor.userId, text: '旧入口同样阻止' },
        ],
      })
      .expect(403);
    await action(b, a.actor.userId, {
      action: 'report',
      id: randomUUID(),
      messageId: first,
      reason: '骚扰',
    }).expect(201);
    expect(await h.db.selectFrom('dm_reports').selectAll().execute()).toHaveLength(1);
    await action(b, a.actor.userId, { action: 'block', value: false }).expect(201);
    await client
      .post('/api/v1/messages/preferences')
      .auth(c.token, { type: 'bearer' })
      .send({ allowRequests: false })
      .expect(201);
    await send(a, c.actor.userId, '关闭请求').expect(403);
    expect((await get(a, '/' + c.actor.userId)).body.conversation.unavailable).toBe(true);
    await client
      .post('/api/v1/messages/preferences')
      .auth(c.token, { type: 'bearer' })
      .send({ allowRequests: true })
      .expect(201);
    await send(a, c.actor.userId, '新请求').expect(201);
    await action(c, a.actor.userId, { action: 'ignore' }).expect(201);
    expect((await get(c, '?view=requests')).body.requests).toBe(0);
    await send(a, c.actor.userId, '忽略后重发').expect(403);
    const oldest = new Date('2025-01-01T00:00:00Z');
    await h.db
      .insertInto('demo_messages')
      .values({
        id: randomUUID(),
        sender_id: b.actor.userId,
        recipient_id: c.actor.userId,
        text: '旧私信',
        post_id: null,
        read_at: null,
        created_at: oldest,
      })
      .execute();
    await up(h.db);
    expect((await get(c)).body.conversations[0].status).toBe('accepted');
    expect((await get(c, '/' + b.actor.userId)).body.messages[0].text).toBe('旧私信');
    await up(h.db);
    expect((await get(c, '/' + b.actor.userId)).body.messages).toHaveLength(1);
    await send(b, c.actor.userId, '迁移后回复').expect(201);
    const oldPage = (
      await get(
        c,
        '/' +
          b.actor.userId +
          '?before=' +
          (await get(c, '/' + b.actor.userId)).body.messages.at(-1).id,
      )
    ).body;
    expect(oldPage.messages).toHaveLength(1);
    const boundary = (await get(c, '/' + b.actor.userId)).body.messages.at(-1).id;
    const base = Date.now() + 1000;
    const batch = Array.from({ length: 120 }, (_, index) => ({
      id: randomUUID(),
      sender_id: b.actor.userId,
      recipient_id: c.actor.userId,
      conversation_id: conversationId(b.actor.userId, c.actor.userId),
      text: '补取消息 ' + index,
      post_id: null,
      read_at: null,
      created_at: new Date(base + index),
    }));
    await h.db.insertInto('demo_messages').values(batch).execute();
    let cursor = boundary;
    const received: string[] = [];
    for (let index = 0; index < 3; index++) {
      const page = (await get(c, '/' + b.actor.userId + '?after=' + cursor).expect(200)).body;
      received.push(...page.messages.map((m: { id: string }) => m.id));
      cursor = page.messages.at(-1).id;
      expect(page.hasMore).toBe(index < 2);
    }
    expect(received).toEqual(batch.map((m) => m.id));
    const snapshot = await client
      .get('/api/v1/demo?messages=omit')
      .auth(c.token, { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(snapshot.body)).not.toContain('补取消息');
  } finally {
    await h.close();
  }
});
