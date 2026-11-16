import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { legacyBoardCommunities } from '../../../packages/contracts/src/boards.js';

it('starts accounts with default subscriptions and preserves explicit unsubscribe choices', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const a = await auth.register({ username: 'subscription_a', password: 'Subscription local 84!' }, 'subscriptions-a');
    const b = await auth.register({ username: 'subscription_b', password: 'Subscription local 84!' }, 'subscriptions-b');
    // Existing accounts can have other preferences without a subscription field.
    await h.db.insertInto('demo_user_states').values({
      user_id: a.actor.userId, data: JSON.stringify({ bookmarks: [] }), updated_at: new Date(),
    }).execute();
    const read = async (token: string) => (await client.get('/api/v1/demo?messages=omit').auth(token, { type: 'bearer' }).expect(200)).body;
    const save = async (followedBoards: string[]) => client.post('/api/v1/demo/operations?messages=omit')
      .auth(a.token, { type: 'bearer' }).send({ id: randomUUID(), operations: [{ type: 'state.save', state: { followedBoards } }] }).expect(201);
    const defaults = Object.keys(legacyBoardCommunities);
    expect((await read(a.token)).userState.followedBoards).toEqual(defaults);
    const remaining = defaults.filter((slug) => slug !== 'market');
    await save(remaining);
    expect((await read(a.token)).userState.followedBoards).toEqual(remaining);
    expect((await read(b.token)).userState.followedBoards).toEqual(defaults);
    await save([]);
    expect((await read(a.token)).userState.followedBoards).toEqual([]);
    await save(['market']);
    expect((await read(a.token)).userState.followedBoards).toEqual(['market']);
  } finally {
    await h.close();
  }
});

it('persists Demo operations, protects ownership, isolates messages and detects Wiki conflicts', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const accounts = [];
    for (const username of ['demo_author', 'demo_reader', 'demo_third'])
      accounts.push(await new PasswordAuthService(h.db).register({ username, password: 'Demo integration 523!' }, username));
    const [a, b, c] = [accounts[0]!, accounts[1]!, accounts[2]!];
    const send = (token: string, operations: unknown[], id = randomUUID()) =>
      client
        .post('/api/v1/demo/operations')
        .auth(token, { type: 'bearer' })
        .send({ id, operations });
    const initial = (await client.get('/api/v1/demo').expect(200)).body;
    expect(initial.content.posts).toEqual([]);
    expect(initial.content.wiki).toEqual([]);
    const post = {
      id: 'p' + randomUUID(),
      community: 'questions',
      title: '一个真实问题',
      body: '内容',
      author: 'forged',
      likes: 999,
    };
    await client
      .post('/api/v1/demo/operations')
      .send({ id: randomUUID(), operations: [{ type: 'post.create', post }] })
      .expect(401);
    const guest = (await client.post('/api/v1/auth/guest').send({}).expect(201)).body;
    await send(guest.token, [{ type: 'post.create', post }]).expect(403);
    for (const id of ['__proto__', 'constructor', 'toString'])
      await send(a.token, [{ type: 'post.create', post: { ...post, id } }]).expect(400);
    const retry = randomUUID();
    await send(a.token, [{ type: 'post.create', post }], retry).expect(201);
    await send(a.token, [{ type: 'post.create', post }], retry).expect(201);
    await send(b.token, [{ type: 'post.update', postId: post.id, body: '篡改' }]).expect(403);
    const reply = { id: 'c' + randomUUID(), body: '回复' };
    await send(b.token, [{ type: 'reply.create', postId: post.id, reply }]).expect(201);
    await send(b.token, [{ type: 'post.accept', postId: post.id, replyId: reply.id }]).expect(403);
    await send(a.token, [{ type: 'post.accept', postId: post.id, replyId: reply.id }]).expect(201);
    await Promise.all([
      send(a.token, [{ type: 'post.vote', postId: post.id, value: true }]).expect(201),
      send(b.token, [{ type: 'post.vote', postId: post.id, value: true }]).expect(201),
    ]);
    await send(b.token, [{ type: 'state.save', state: { bookmarks: [post.id] } }]).expect(201);
    const wiki = {
      id: 'w' + randomUUID(),
      title: '测试词条',
      summary: '摘要',
      communities: ['questions'],
      sections: [{ h: '第一章', p: '内容' }],
      quick: [],
      reference: '',
    };
    await send(a.token, [{ type: 'wiki.save', wiki, baseRevision: 0, reason: '创建词条' }]).expect(
      201,
    );
    await send(b.token, [
      { type: 'wiki.save', wiki: { ...wiki, summary: '更新' }, baseRevision: 1, reason: '补充' },
    ]).expect(201);
    await send(a.token, [{ type: 'wiki.save', wiki, baseRevision: 1, reason: '过期修改' }]).expect(
      409,
    );
    const suggestionId = 's' + randomUUID();
    await send(b.token, [{
      type: 'wiki.suggest', id: suggestionId, wikiId: wiki.id, index: 0,
      text: '需要补充的步骤', reference: '',
    }]).expect(201);
    const revised = (await send(a.token, [{
      type: 'wiki.save', wiki, baseRevision: 2, reason: '整理补充', applied: [suggestionId],
    }]).expect(201)).body;
    expect(revised.content.wiki[0].suggestions[0]).toMatchObject({ id: suggestionId, applied: true });
    await send(a.token, [
      { type: 'message.send', id: randomUUID(), peer: b.actor.userId, text: '只有双方可见' },
    ]).expect(201);
    const own = (await client.get('/api/v1/demo').auth(a.token, { type: 'bearer' }).expect(200))
      .body;
    const reader = (await client.get('/api/v1/demo').auth(b.token, { type: 'bearer' }).expect(200))
      .body;
    const third = (await client.get('/api/v1/demo').auth(c.token, { type: 'bearer' }).expect(200))
      .body;
    const publicView = (await client.get('/api/v1/demo').expect(200)).body;
    expect(publicView.content.posts).toHaveLength(1);
    expect(publicView.content.posts[0].author).not.toBe('forged');
    expect(publicView.content.posts[0].likes).toBe(2);
    expect(own.userState.best[post.id]).toBe(reply.id);
    expect(own.userState.bookmarks || []).toEqual([]);
    expect(reader.userState.bookmarks).toEqual([post.id]);
    expect(reader.userState.threads[0].messages[0].text).toBe('只有双方可见');
    expect(reader.userState.threads[0].unread).toBe(true);
    expect(third.userState.threads).toEqual([]);
    expect(publicView.userState.threads).toEqual([]);
    expect(publicView.content.wiki[0].revisions).toBe(3);
    expect(own.content.notifications).toHaveLength(1);
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=';
    const pictured = {
      id: 'p' + randomUUID(),
      community: 'daily',
      title: '图片帖子',
      body: '',
      images: [png],
    };
    const imageResult = (await send(a.token, [{ type: 'post.create', post: pictured }]).expect(201))
      .body;
    const imageUrl = imageResult.content.posts.find(
      (post: { id: string }) => post.id === pictured.id,
    ).images[0];
    expect(imageUrl).toMatch(/^\/api\/backend\/demo\/assets\//);
    await client
      .get('/api/v1/demo/assets/' + imageUrl.split('/').at(-1))
      .expect('Content-Type', /image\/png/)
      .expect(200);
    await send(a.token, [
      {
        type: 'post.create',
        post: {
          ...pictured,
          id: 'p' + randomUUID(),
          images: ['data:image/svg+xml;base64,PHN2Zz4='],
        },
      },
    ]).expect(400);
    await send(b.token, [{ type: 'post.report', postId: post.id, reason: '测试举报' }]).expect(201);
    expect(
      (await h.db.selectFrom('demo_entities').selectAll().where('kind', '=', 'report').execute())
        .length,
    ).toBe(1);
    await send(b.token, [{ type: 'message.read', peer: a.actor.userId }]).expect(201);
    expect(
      (await client.get('/api/v1/demo').auth(b.token, { type: 'bearer' })).body.userState.threads[0]
        .unread,
    ).toBe(false);
  } finally {
    await h.close();
  }
});
