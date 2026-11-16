import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';

it('lists only active mute and suspension targets in the selected community restricted-user view', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const accounts = await Promise.all(
      [
        'restricted_mod',
        'restricted_muted',
        'restricted_banned',
        'restricted_other',
        'restricted_expired',
        'restricted_revoked',
        'restricted_wiki',
        'restricted_global',
        'restricted_legacy',
      ].map((username) => auth.register({ username, password: 'Workspace tests 923!' }, username)),
    );
    const [mod, muted, banned, other, expired, revoked, wiki, global, legacy] = accounts;
    await h.db
      .insertInto('moderation_groups')
      .values({
        id: 'restricted-test',
        name: '受限用户测试',
        boards: JSON.stringify(['daily', 'market']),
        permissions: JSON.stringify(['users.view', 'users.mute', 'users.suspend']),
      })
      .execute();
    await h.db
      .insertInto('moderation_group_members')
      .values({
        group_id: 'restricted-test',
        user_id: mod!.actor.userId,
      })
      .execute();
    const future = new Date(Date.now() + 86400000);
    const past = new Date(Date.now() - 86400000);
    await h.db
      .insertInto('moderation_penalties')
      .values(
        [
          {
            user_id: muted!.actor.userId,
            board: 'daily',
            capability: 'publish',
            until_at: future,
            revoked_at: null,
          },
          {
            user_id: banned!.actor.userId,
            board: 'daily',
            capability: 'suspension',
            until_at: null,
            revoked_at: null,
          },
          {
            user_id: other!.actor.userId,
            board: 'market',
            capability: 'publish',
            until_at: future,
            revoked_at: null,
          },
          {
            user_id: expired!.actor.userId,
            board: 'daily',
            capability: 'publish',
            until_at: past,
            revoked_at: null,
          },
          {
            user_id: revoked!.actor.userId,
            board: 'daily',
            capability: 'publish',
            until_at: future,
            revoked_at: past,
          },
          {
            user_id: wiki!.actor.userId,
            board: 'daily',
            capability: 'wiki',
            until_at: future,
            revoked_at: null,
          },
          {
            user_id: global!.actor.userId,
            board: null,
            capability: 'suspension',
            until_at: future,
            revoked_at: null,
          },
        ].map((penalty) => ({
          ...penalty,
          id: randomUUID(),
          reason: '限制原因测试',
          created_at: new Date(),
        })),
      )
      .execute();
    await h.db
      .insertInto('community_restrictions')
      .values({
        user_id: legacy!.actor.userId,
        board: 'daily',
        until_at: future,
        reason: '旧版禁言',
      })
      .execute();
    const list = (status = 'restricted', board = 'daily', q = '') =>
      client
        .get(
          '/api/v1/admin/community/items?' +
            new URLSearchParams({ section: 'users', status, board, q }),
        )
        .auth(mod!.token, { type: 'bearer' });
    const restricted = (await list().expect(200)).body;
    expect(restricted.total).toBe(3);
    expect(restricted.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [muted!.actor.userId, banned!.actor.userId, legacy!.actor.userId].sort(),
    );
    expect((await list('muted').expect(200)).body.total).toBe(2);
    expect((await list('suspended').expect(200)).body.items[0].id).toBe(banned!.actor.userId);
    expect((await list('restricted', 'market').expect(200)).body.items[0].id).toBe(
      other!.actor.userId,
    );
    expect((await list('restricted', 'daily', 'restricted_muted').expect(200)).body.total).toBe(1);
    await client
      .post('/api/v1/admin/community/actions?board=daily')
      .auth(mod!.token, { type: 'bearer' })
      .send({
        id: randomUUID(),
        action: 'penalty.revoke',
        target: restricted.items.find((item: { id: string }) => item.id === muted!.actor.userId)
          .penalties[0].id,
        reason: '解除测试禁言',
      })
      .expect(201);
    expect((await list().expect(200)).body.total).toBe(2);
    expect((await list('muted').expect(200)).body.items[0].id).toBe(legacy!.actor.userId);
  } finally {
    await h.close();
  }
});

it('scopes moderators, grants community teams, enforces local restrictions, locks and Wiki protection', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const register = (username: string) =>
      auth.register({ username, password: 'Workspace tests 923!' }, username);
    const admin = await register('workspace_admin');
    const owner = await register('workspace_owner');
    const mod = await register('workspace_mod');
    const author = await register('workspace_author');
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin.actor.userId, role: 'admin' })
      .execute();
    const act = (token: string, body: object, board?: string) =>
      client
        .post('/api/v1/admin/community/actions' + (board ? '?board=' + board : ''))
        .auth(token, { type: 'bearer' })
        .send({ id: randomUUID(), reason: '工作台集成验证', ...body });
    const send = (token: string, operations: object[]) =>
      client
        .post('/api/v1/demo/operations')
        .auth(token, { type: 'bearer' })
        .send({ id: randomUUID(), operations });
    const list = (token: string, section: string, board?: string) =>
      client
        .get(
          '/api/v1/admin/community/items?' +
            new URLSearchParams({ section, ...(board ? { board } : {}) }),
        )
        .auth(token, { type: 'bearer' });
    const groupResponse = await client
      .post('/api/v1/admin/community/groups')
      .auth(admin.token, { type: 'bearer' })
      .send({
        name: '工作台管理',
        boards: ['daily'],
        permissions: ['reports', 'content', 'users', 'wiki', 'history'],
        members: ['workspace_owner', 'workspace_mod'],
      })
      .expect(201);
    await act(
      mod.token,
      { action: 'member.role', target: author.actor.userId, role: 'moderator' },
      'daily',
    ).expect(403);
    await client
      .get('/api/v1/admin/community/overview?board=invalid')
      .auth(admin.token, { type: 'bearer' })
      .expect(400);
    await list(mod.token, 'content').expect(403);
    await list(mod.token, 'content', 'market').expect(403);
    await send(
      author.token,
      ['daily', 'market'].map((community) => ({
        type: 'post.create',
        post: { id: community, title: community + ' 测试帖', body: '测试正文', community },
      })),
    ).expect(201);
    const content = (await list(mod.token, 'content', 'daily').expect(200)).body.items;
    expect(content.map((item: { id: string }) => item.id)).toEqual(['post:daily']);
    await act(
      mod.token,
      { action: 'visibility', target: 'post:market', hidden: true },
      'daily',
    ).expect(403);
    await act(
      mod.token,
      { action: 'post.settings', target: 'post:daily', community: 'market' },
      'daily',
    ).expect(403);
    await act(
      mod.token,
      { action: 'post.settings', target: 'post:daily', pinned: true, locked: true },
      'daily',
    ).expect(201);
    await send(author.token, [
      { type: 'reply.create', postId: 'daily', reply: { id: 'locked', body: '不能回复' } },
    ]).expect(403);
    await send(author.token, [
      { type: 'reply.create', postId: 'market', reply: { id: 'ok', body: '可以回复' } },
    ]).expect(201);
    await act(
      mod.token,
      { action: 'restriction', target: author.actor.userId, hours: 24 },
      'daily',
    ).expect(201);
    await send(author.token, [
      {
        type: 'post.create',
        post: { id: 'blocked', title: '社区禁言', body: '不能发帖', community: 'daily' },
      },
    ]).expect(403);
    await send(author.token, [
      {
        type: 'post.create',
        post: { id: 'allowed', title: '其他社区', body: '可以发帖', community: 'market' },
      },
    ]).expect(201);
    await client
      .post('/api/v1/messages/' + admin.actor.userId + '/send')
      .auth(author.token, { type: 'bearer' })
      .send({ id: randomUUID(), text: '社区禁言不影响私信' })
      .expect(201);
    await act(
      mod.token,
      { action: 'restriction', target: owner.actor.userId, hours: 24 },
      'daily',
    ).expect(403);
    await h.db
      .updateTable('moderation_penalties')
      .set({ until_at: new Date(Date.now() - 1000) })
      .where('user_id', '=', author.actor.userId)
      .where('board', '=', 'daily')
      .execute();
    await send(author.token, [
      {
        type: 'post.create',
        post: { id: 'expired', title: '到期恢复', body: '可以发帖', community: 'daily' },
      },
    ]).expect(201);
    await act(
      mod.token,
      { action: 'restriction', target: author.actor.userId, hours: 0 },
      'daily',
    ).expect(201);
    const wiki = {
      id: 'protected',
      title: '受保护词条',
      summary: '测试摘要',
      communities: ['daily'],
      sections: [{ h: '正文', p: '测试内容' }],
      quick: [],
      reference: '',
    };
    await send(author.token, [
      { type: 'wiki.save', wiki, baseRevision: 0, reason: '创建词条' },
    ]).expect(201);
    await act(
      mod.token,
      { action: 'wiki.protect', target: wiki.id, protected: true },
      'daily',
    ).expect(201);
    await send(author.token, [
      { type: 'wiki.save', wiki, baseRevision: 1, reason: '普通修改' },
    ]).expect(403);
    await send(mod.token, [
      { type: 'wiki.save', wiki, baseRevision: 1, reason: '管理修改' },
    ]).expect(201);
    const shared = { ...wiki, id: 'shared', communities: ['daily', 'market'] };
    await send(author.token, [
      { type: 'wiki.save', wiki: shared, baseRevision: 0, reason: '跨社区词条' },
    ]).expect(201);
    await send(author.token, [
      {
        type: 'wiki.save',
        wiki: { ...shared, communities: ['daily'] },
        baseRevision: 1,
        reason: '缩小当前范围',
      },
    ]).expect(201);
    await act(
      mod.token,
      { action: 'wiki.restore', target: shared.id, revision: 1, baseRevision: 2 },
      'daily',
    ).expect(403);
    await send(author.token, [
      { type: 'wiki.save', wiki: shared, baseRevision: 2, reason: '恢复跨社区范围' },
    ]).expect(201);
    await act(
      mod.token,
      { action: 'wiki.protect', target: shared.id, protected: true },
      'daily',
    ).expect(403);
    await act(admin.token, { action: 'wiki.protect', target: shared.id, protected: true }).expect(
      201,
    );
    await send(mod.token, [
      {
        type: 'wiki.save',
        wiki: { ...shared, communities: ['daily'] },
        baseRevision: 3,
        reason: '绕过保护',
      },
    ]).expect(403);
    await client
      .post('/api/v1/messages/' + author.actor.userId + '/action')
      .auth(admin.token, { type: 'bearer' })
      .send({
        action: 'report',
        id: randomUUID(),
        messageId: (
          await h.db
            .selectFrom('demo_messages')
            .select('id')
            .where('sender_id', '=', author.actor.userId)
            .executeTakeFirstOrThrow()
        ).id,
        reason: '私信举报仅限全站管理',
      })
      .expect(201);
    expect((await list(mod.token, 'reports', 'daily').expect(200)).body.items).toEqual([]);
    expect(
      (await list(admin.token, 'reports').expect(200)).body.items.some(
        (item: { kind: string }) => item.kind === 'message',
      ),
    ).toBe(true);
    const note = '仅管理人员可见的内部备注';
    await act(
      admin.token,
      { action: 'note', target: author.actor.userId, reason: note },
      'daily',
    ).expect(201);
    const context = await client
      .get('/api/v1/admin/community/context?board=daily&user=' + author.actor.userId)
      .auth(mod.token, { type: 'bearer' })
      .expect(200);
    expect(context.body.records.some((record: { reason: string }) => record.reason === note)).toBe(
      false,
    );
    expect(JSON.stringify((await client.get('/api/v1/demo')).body)).not.toContain(note);
    await client
      .get('/api/v1/admin/community/context?board=market&user=' + author.actor.userId)
      .auth(mod.token, { type: 'bearer' })
      .expect(403);
    const otherHistory = await list(admin.token, 'history', 'market').expect(200);
    expect(JSON.stringify(otherHistory.body)).not.toContain(note);
    await client
      .post('/api/v1/admin/community/membership')
      .auth(admin.token, { type: 'bearer' })
      .send({ groupId: groupResponse.body.id, userId: mod.actor.userId, member: false })
      .expect(201);
    await list(mod.token, 'content', 'daily').expect(403);
    await act(
      mod.token,
      { action: 'visibility', target: 'post:daily', hidden: true },
      'daily',
    ).expect(403);
  } finally {
    await h.close();
  }
});

it('merges target reports and atomically resolves reports, dispositions, notifications and retries', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const accounts = await Promise.all(
      ['case_admin', 'case_author', 'case_reader', 'case_reader2'].map((username) =>
        auth.register({ username, password: 'Workspace tests 923!' }, username),
      ),
    );
    const [admin, author, reader, reader2] = accounts;
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin!.actor.userId, role: 'admin' })
      .execute();
    const send = (token: string, operations: object[]) =>
      client
        .post('/api/v1/demo/operations')
        .auth(token, { type: 'bearer' })
        .send({ id: randomUUID(), operations });
    const act = (body: object) =>
      client
        .post('/api/v1/admin/community/actions')
        .auth(admin!.token, { type: 'bearer' })
        .send(body);
    await send(author!.token, [
      {
        type: 'post.create',
        post: { id: 'case', title: '举报合并测试', body: '正文', community: 'daily' },
      },
    ]).expect(201);
    for (const account of [reader!, reader2!])
      await send(account.token, [
        { type: 'post.report', postId: 'case', reason: '举报原因 ' + account.actor.userId },
      ]).expect(201);
    const get = () =>
      client
        .get('/api/v1/admin/community/items?section=reports')
        .auth(admin!.token, { type: 'bearer' });
    const cases = (await get().expect(200)).body.items;
    expect(cases).toHaveLength(1);
    expect(cases[0].reportIds).toHaveLength(2);
    const action = {
      id: randomUUID(),
      action: 'case.resolve',
      target: 'post:case',
      reportIds: cases[0].reportIds,
      hidden: true,
      hours: 24,
      outcome: 'handled',
      reason: '核实违规并处置',
    };
    // A failed restriction rolls the preceding visibility change back.
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: author!.actor.userId, role: 'admin' })
      .execute();
    await act(action).expect(403);
    expect(await h.db.selectFrom('admin_visibility').selectAll().execute()).toHaveLength(0);
    expect(await h.db.selectFrom('admin_report_results').selectAll().execute()).toHaveLength(0);
    expect(await h.db.selectFrom('admin_notifications').selectAll().execute()).toHaveLength(0);
    await h.db.deleteFrom('platform_roles').where('user_id', '=', author!.actor.userId).execute();
    await Promise.all([act(action).expect(201), act(action).expect(201)]);
    expect(await h.db.selectFrom('admin_actions').selectAll().execute()).toHaveLength(1);
    expect(await h.db.selectFrom('admin_report_results').selectAll().execute()).toHaveLength(2);
    expect(await h.db.selectFrom('admin_notifications').selectAll().execute()).toHaveLength(3);
    await act({ ...action, id: randomUUID() }).expect(409);
    await act({ ...action, hidden: false }).expect(409);
    expect((await get()).body.items[0].status).toBe('handled');
    // A new report remains pending after an earlier case was closed.
    await act({
      id: randomUUID(),
      action: 'visibility',
      target: 'post:case',
      hidden: false,
      reason: '恢复以验证新举报',
    }).expect(201);
    await send(reader!.token, [
      { type: 'post.report', postId: 'case', reason: '结案后的新举报' },
    ]).expect(201);
    const groups = (await get()).body.items;
    expect(
      groups.find((item: { status: string }) => item.status === 'pending').reportIds,
    ).toHaveLength(1);
    expect(
      groups.find((item: { status: string }) => item.status === 'handled').reportIds,
    ).toHaveLength(2);
  } finally {
    await h.close();
  }
});
