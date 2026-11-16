import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';

it('protects administration, hides current content and quotes, resolves legacy reports and records retries once', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const admin = await auth.register(
      { username: 'site_admin', password: 'Admin integration 523!' },
      'admin',
    );
    const author = await auth.register(
      { username: 'site_author', password: 'Admin integration 523!' },
      'author',
    );
    const reader = await auth.register(
      { username: 'site_reader', password: 'Admin integration 523!' },
      'reader',
    );
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin.actor.userId, role: 'admin' })
      .execute();
    const get = (section: string, token = admin.token) =>
      client
        .get('/api/v1/admin/community/items?section=' + section)
        .auth(token, { type: 'bearer' });
    const act = (body: object, token = admin.token) =>
      client
        .post('/api/v1/admin/community/actions')
        .auth(token, { type: 'bearer' })
        .send({ id: randomUUID(), reason: '管理测试原因', ...body });
    const send = (token: string, operations: unknown[]) =>
      client
        .post('/api/v1/demo/operations')
        .auth(token, { type: 'bearer' })
        .send({ id: randomUUID(), operations });
    await client.get('/api/v1/admin/community/overview').expect(401);
    await get('content', author.token).expect(403);
    await act(
      { action: 'restriction', target: reader.actor.userId, hours: 24 },
      author.token,
    ).expect(403);
    await act({ action: 'visibility', target: 'post:missing', hidden: true }).expect(404);
    await act({ action: 'restriction', target: admin.actor.userId, hours: 24 }).expect(403);
    await act({ action: 'restriction', target: reader.actor.userId, hours: -10 }).expect(400);
    await send(author.token, [
      {
        type: 'post.create',
        post: { id: 'question', title: '管理测试帖子', body: '原帖内容', community: 'questions' },
      },
    ]).expect(201);
    await send(reader.token, [
      {
        type: 'reply.create',
        postId: 'question',
        reply: { id: 'answer', body: '需要隐藏的机密原文' },
      },
    ]).expect(201);
    await send(author.token, [
      {
        type: 'reply.create',
        postId: 'question',
        reply: { id: 'quote', body: '回复引用', replyTo: 'answer', parentId: 'answer' },
      },
      { type: 'post.accept', postId: 'question', replyId: 'answer' },
    ]).expect(201);
    // Reports created before the administration module are listed directly from the old store.
    await h.db
      .insertInto('demo_entities')
      .values({
        id: 'report:legacy',
        kind: 'report',
        data: JSON.stringify({
          userId: reader.actor.userId,
          postId: 'question',
          reason: '旧举报原因',
          createdAt: Date.now(),
        }),
      })
      .execute();
    const reports = (await get('reports').expect(200)).body.items;
    expect(reports[0]).toMatchObject({
      id: 'report:legacy',
      status: 'pending',
      body: '原帖内容',
      reporter: 'site_reader',
    });
    const hide = {
      id: randomUUID(),
      action: 'visibility',
      target: 'reply:question:answer',
      hidden: true,
    };
    await Promise.all([act(hide).expect(201), act(hide).expect(201)]);
    expect(
      await h.db.selectFrom('admin_actions').selectAll().where('id', '=', hide.id).execute(),
    ).toHaveLength(1);
    expect(
      await h.db
        .selectFrom('admin_notifications')
        .selectAll()
        .where('user_id', '=', reader.actor.userId)
        .execute(),
    ).toHaveLength(1);
    await act({ ...hide, hidden: false }).expect(409);
    const snapshot = (await client.get('/api/v1/demo').expect(200)).body;
    expect(JSON.stringify(snapshot)).not.toContain('需要隐藏的机密原文');
    expect(snapshot.content.comments.question[0].body).toContain('已被管理员隐藏');
    expect(snapshot.content.posts[0].best).toBeUndefined();
    expect(
      (await get('content').expect(200)).body.items.find(
        (item: { id: string }) => item.id === hide.target,
      ).body,
    ).toBe('需要隐藏的机密原文');
    await send(author.token, [
      { type: 'reply.vote', postId: 'question', replyId: 'answer', value: true },
    ]).expect(403);
    await send(author.token, [
      {
        type: 'reply.create',
        postId: 'question',
        reply: { id: 'newreply', body: '绕过隐藏', replyTo: 'answer' },
      },
    ]).expect(403);
    await act({ action: 'visibility', target: hide.target, hidden: false }).expect(201);
    expect(JSON.stringify((await client.get('/api/v1/demo')).body)).toContain('需要隐藏的机密原文');
    await act({ action: 'visibility', target: 'post:question', hidden: true }).expect(201);
    const hiddenSnapshot = (await client.get('/api/v1/demo')).body;
    expect(hiddenSnapshot.content.posts).toEqual([]);
    expect(hiddenSnapshot.content.comments).toEqual({});
    await send(author.token, [
      { type: 'post.update', postId: 'question', body: '隐藏后更新' },
    ]).expect(403);
    await act({ action: 'visibility', target: 'post:question', hidden: false }).expect(201);
    const resolve = { action: 'report', target: 'report:legacy', outcome: 'handled' };
    const concurrent = await Promise.all([act(resolve), act(resolve)]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
    const readerView = (await client.get('/api/v1/demo').auth(reader.token, { type: 'bearer' }))
      .body;
    expect(
      readerView.content.notifications.some(
        (item: { text: string }) => item.text === '你的举报已处理',
      ),
    ).toBe(true);
    expect((await get('reports').expect(200)).body.items[0].status).toBe('handled');
    expect((await get('history').expect(200)).body.total).toBeGreaterThan(4);
    await h.db.deleteFrom('platform_roles').where('user_id', '=', admin.actor.userId).execute();
    await get('content').expect(403);
  } finally {
    await h.close();
  }
});

it('enforces timed restrictions on batches and both private-message paths, allows reports, and expires restrictions', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const admin = await auth.register(
      { username: 'mute_admin', password: 'Admin integration 523!' },
      'admin',
    );
    const a = await auth.register(
      { username: 'mute_author', password: 'Admin integration 523!' },
      'author',
    );
    const b = await auth.register(
      { username: 'mute_reader', password: 'Admin integration 523!' },
      'reader',
    );
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin.actor.userId, role: 'owner' })
      .execute();
    const act = (body: object) =>
      client
        .post('/api/v1/admin/community/actions')
        .auth(admin.token, { type: 'bearer' })
        .send({ id: randomUUID(), reason: '重复骚扰处理', ...body });
    const send = (token: string, operations: unknown[]) =>
      client
        .post('/api/v1/demo/operations')
        .auth(token, { type: 'bearer' })
        .send({ id: randomUUID(), operations });
    const post = { id: 'mute-post', title: '帖子', body: '测试内容', community: 'daily' };
    await send(a.token, [{ type: 'post.create', post }]).expect(201);
    const message = randomUUID();
    await client
      .post('/api/v1/messages/' + b.actor.userId + '/send')
      .auth(a.token, { type: 'bearer' })
      .send({ id: message, text: '被举报私信' })
      .expect(201);
    await client
      .post('/api/v1/messages/' + a.actor.userId + '/action')
      .auth(b.token, { type: 'bearer' })
      .send({ action: 'report', id: randomUUID(), messageId: message, reason: '骚扰信息' })
      .expect(201);
    await client
      .post('/api/v1/messages/' + a.actor.userId + '/action')
      .auth(b.token, { type: 'bearer' })
      .send({ action: 'accept' })
      .expect(201);
    await client
      .post('/api/v1/messages/' + b.actor.userId + '/send')
      .auth(a.token, { type: 'bearer' })
      .send({ id: randomUUID(), text: '未举报的私人消息' })
      .expect(201);
    const reports = (
      await client
        .get('/api/v1/admin/community/items?section=reports')
        .auth(admin.token, { type: 'bearer' })
        .expect(200)
    ).body;
    expect(reports.items[0]).toMatchObject({
      kind: 'message',
      body: '被举报私信',
      authorId: a.actor.userId,
    });
    expect(JSON.stringify(reports)).not.toContain('未举报的私人消息');
    await act({ action: 'report', target: reports.items[0].id, outcome: 'dismissed' }).expect(201);
    await act({ action: 'restriction', target: a.actor.userId, hours: 1 }).expect(201);
    await send(a.token, [
      { type: 'state.save', state: { bookmarks: ['mute-post'] } },
      { type: 'post.create', post: { ...post, id: 'blocked' } },
    ]).expect(403);
    const own = (await client.get('/api/v1/demo').auth(a.token, { type: 'bearer' })).body;
    expect(own.userState.bookmarks || []).toEqual([]);
    await send(a.token, [{ type: 'post.report', postId: 'mute-post', reason: '仍能反馈' }]).expect(
      201,
    );
    await send(a.token, [
      { type: 'reply.create', postId: 'mute-post', reply: { id: 'blocked', body: '禁言测试' } },
    ]).expect(403);
    await send(a.token, [
      { type: 'message.send', id: randomUUID(), peer: b.actor.userId, text: '绕过禁言' },
    ]).expect(403);
    await client
      .post('/api/v1/messages/' + b.actor.userId + '/send')
      .auth(a.token, { type: 'bearer' })
      .send({ id: randomUUID(), text: '绕过禁言' })
      .expect(403);
    await h.db
      .updateTable('moderation_penalties')
      .set({ until_at: new Date(Date.now() - 1000) })
      .where('user_id', '=', a.actor.userId)
      .execute();
    await send(a.token, [
      { type: 'reply.create', postId: 'mute-post', reply: { id: 'expired', body: '到期后恢复' } },
    ]).expect(201);
    await act({ action: 'restriction', target: a.actor.userId, hours: 24 }).expect(201);
    await act({ action: 'restriction', target: a.actor.userId, hours: 0 }).expect(201);
    await client
      .post('/api/v1/messages/' + b.actor.userId + '/send')
      .auth(a.token, { type: 'bearer' })
      .send({ id: randomUUID(), text: '解除后恢复' })
      .expect(201);
  } finally {
    await h.close();
  }
});

it('restores old Wiki revisions as new versions and rejects concurrent edits and stale retries', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const account = await new PasswordAuthService(h.db).register(
      { username: 'wiki_admin', password: 'Admin integration 523!' },
      'admin',
    );
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: account.actor.userId, role: 'admin' })
      .execute();
    const send = (operations: unknown[]) =>
      client
        .post('/api/v1/demo/operations')
        .auth(account.token, { type: 'bearer' })
        .send({ id: randomUUID(), operations });
    const wiki = {
      id: 'admin-wiki',
      title: '社区指南',
      summary: '初版摘要',
      communities: ['daily'],
      sections: [{ h: '说明', p: '初版正文' }],
      quick: [],
      reference: '',
    };
    await send([{ type: 'wiki.save', wiki, baseRevision: 0, reason: '创建' }]).expect(201);
    await send([
      {
        type: 'wiki.save',
        wiki: { ...wiki, summary: '第二版摘要', table: { heads: ['信息'], rows: [['新版表格']] } },
        baseRevision: 1,
        reason: '更新',
      },
    ]).expect(201);
    const action = {
      id: randomUUID(),
      action: 'wiki.restore',
      target: wiki.id,
      revision: 1,
      baseRevision: 2,
      reason: '恢复可靠内容',
    };
    // Older Wiki history snapshots did not always include communities or id.
    const stored = await h.db
      .selectFrom('demo_entities')
      .select('data')
      .where('id', '=', 'wiki:' + wiki.id)
      .executeTakeFirstOrThrow();
    const legacy = JSON.parse(stored.data);
    delete legacy.history[1].after.communities;
    delete legacy.history[1].after.id;
    await h.db
      .updateTable('demo_entities')
      .set({ data: JSON.stringify(legacy) })
      .where('id', '=', 'wiki:' + wiki.id)
      .execute();
    const restore = (body: object) =>
      client
        .post('/api/v1/admin/community/actions')
        .auth(account.token, { type: 'bearer' })
        .send(body);
    await Promise.all([restore(action).expect(201), restore(action).expect(201)]);
    const snapshot = (await client.get('/api/v1/demo')).body.content.wiki[0];
    expect(snapshot).toMatchObject({ revisions: 3, summary: '初版摘要', communities: ['daily'] });
    expect(snapshot.history).toHaveLength(3);
    expect(snapshot.table).toBeNull();
    expect(snapshot.history[0]).toMatchObject({
      before: { summary: '第二版摘要' },
      after: { summary: '初版摘要' },
    });
    await restore({ ...action, id: randomUUID() }).expect(409);
    await send([{ type: 'wiki.save', wiki, baseRevision: 2, reason: '过时编辑' }]).expect(409);
    await restore({ ...action, id: randomUUID(), revision: 3, baseRevision: 3 }).expect(409);
    expect(await h.db.selectFrom('admin_actions').selectAll().execute()).toHaveLength(1);
  } finally {
    await h.close();
  }
});
