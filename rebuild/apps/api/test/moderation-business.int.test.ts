import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';

it('preserves report evidence, scopes reporter identity, enforces independent penalties and supports restricted-login appeals', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const accounts = await Promise.all(
      ['gov_admin', 'gov_reviewer', 'gov_author', 'gov_reader', 'gov_mod'].map((username) =>
        auth.register({ username, password: 'Governance tests 923!' }, username),
      ),
    );
    const [admin, reviewer, author, reader, mod] = accounts as [
      (typeof accounts)[number],
      (typeof accounts)[number],
      (typeof accounts)[number],
      (typeof accounts)[number],
      (typeof accounts)[number],
    ];
    await h.db
      .insertInto('platform_roles')
      .values([admin, reviewer].map((a) => ({ user_id: a.actor.userId, role: 'admin' })))
      .execute();
    const act = (body: object, token = admin.token, board = '') =>
      client
        .post('/api/v1/admin/community/actions' + (board ? '?board=' + board : ''))
        .auth(token, { type: 'bearer' })
        .send({ id: randomUUID(), reason: '治理验证原因', ...body });
    const send = (operations: object[]) =>
      client
        .post('/api/v1/demo/operations')
        .auth(author.token, { type: 'bearer' })
        .send({ id: randomUUID(), operations });
    const status = () => client.get('/api/v1/governance').auth(author.token, { type: 'bearer' });
    await send([
      {
        type: 'post.create',
        post: { id: 'gov-post', title: '举报快照', body: '证据原文', community: 'daily' },
      },
    ]).expect(201);
    await client.post('/api/v1/admin/community/groups').auth(admin.token, { type: 'bearer' }).send({ name: '社区审核', boards: ['daily'], permissions: ['reports', 'content', 'users', 'wiki', 'history'], members: ['gov_mod'] }).expect(201);
    const report = () =>
      client
        .post('/api/v1/governance/reports')
        .auth(reader.token, { type: 'bearer' })
        .send({ target: 'post:gov-post', category: 'harassment', detail: '测试说明' });
    const reports = await Promise.all([report().expect(201), report().expect(201)]);
    expect(reports[0]!.body.id).toBe(reports[1]!.body.id);
    await send([
      { type: 'post.edit', postId: 'gov-post', title: '举报快照', body: '编辑后的正文' },
    ]).expect(201);
    const listed = await client
      .get('/api/v1/admin/community/items?section=reports&board=daily')
      .auth(mod.token, { type: 'bearer' })
      .expect(200);
    expect(listed.body.items[0].body).toBe('证据原文');
    expect(JSON.stringify(listed.body)).not.toContain('gov_reader');
    await act({ action: 'case.escalate', target: 'post:gov-post' }, mod.token, 'daily').expect(201);
    await act(
      {
        action: 'case.resolve',
        target: 'post:gov-post',
        reportIds: [reports[0]!.body.id],
        outcome: 'handled',
        hidden: true,
        hours: 0,
      },
      mod.token,
      'daily',
    ).expect(409);
    const removed = randomUUID();
    await act({ id: removed, action: 'visibility', target: 'post:gov-post', hidden: true }).expect(
      201,
    );
    const snapshot = await client.get('/api/v1/demo').expect(200);
    expect(snapshot.body.tombstones).toEqual([{ id: 'gov-post', community: 'daily' }]);
    expect(JSON.stringify(snapshot.body.content)).not.toContain('编辑后的正文');
    await client
      .post('/api/v1/governance/appeals')
      .auth(reader.token, { type: 'bearer' })
      .send({ actionId: removed, reason: '尝试越权申诉' })
      .expect(403);
    const appeal = await client
      .post('/api/v1/governance/appeals')
      .auth(author.token, { type: 'bearer' })
      .send({ actionId: removed, reason: '请求复核移除' })
      .expect(201);
    await act({ action: 'appeal.review', target: appeal.body.id, outcome: 'reversed' }).expect(403);
    await act(
      { action: 'appeal.review', target: appeal.body.id, outcome: 'reversed' },
      reviewer.token,
    ).expect(201);
    expect((await client.get('/api/v1/demo')).body.content.posts).toHaveLength(1);
    const publish = randomUUID(),
      wiki = randomUUID();
    await act({
      id: publish,
      action: 'penalty',
      target: author.actor.userId,
      capability: 'publish',
      hours: 24,
    }).expect(201);
    await act({
      id: wiki,
      action: 'penalty',
      target: author.actor.userId,
      capability: 'wiki',
      hours: 24,
    }).expect(201);
    await send([
      {
        type: 'post.create',
        post: { id: 'denied', title: '受限', body: '正文', community: 'daily' },
      },
    ]).expect(403);
    await act({ action: 'penalty.revoke', target: publish }).expect(201);
    await send([
      {
        type: 'post.create',
        post: { id: 'allowed', title: '恢复发布', body: '正文', community: 'daily' },
      },
    ]).expect(201);
    expect((await status()).body.actions.find((a: { id: string }) => a.id === wiki).status).toBe(
      'active',
    );
    const ban = randomUUID();
    await act({
      id: ban,
      action: 'penalty',
      target: author.actor.userId,
      capability: 'suspension',
      hours: 0,
    }).expect(201);
    await expect(auth.authenticate(author.token)).rejects.toThrow();
    expect(
      (await client.get('/api/v1/demo').auth(author.token, { type: 'bearer' })).body.suspended,
    ).toBe(true);
    expect((await status()).body.suspended).toBe(true);
    await auth.login(
      { username: 'gov_author', password: 'Governance tests 923!' },
      'restricted-login',
    );
    const banAppeal = await client
      .post('/api/v1/governance/appeals')
      .auth(author.token, { type: 'bearer' })
      .send({ actionId: ban, reason: '请求解除封禁' })
      .expect(201);
    await act(
      { action: 'appeal.review', target: banAppeal.body.id, outcome: 'reversed' },
      reviewer.token,
    ).expect(201);
    expect((await status()).body.suspended).toBe(false);
    expect((await status()).body.actions.find((a: { id: string }) => a.id === wiki).status).toBe(
      'active',
    );
  } finally {
    await h.close();
  }
});

it('expires wiki protections and redacts hidden revisions plus adjacent copies across public and scoped admin views', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const admin = await auth.register(
      { username: 'wiki_gov_admin', password: 'Governance tests 923!' },
      'admin',
    );
    const author = await auth.register(
      { username: 'wiki_gov_author', password: 'Governance tests 923!' },
      'author',
    );
    const mod = await auth.register(
      { username: 'wiki_gov_mod', password: 'Governance tests 923!' },
      'moderator',
    );
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin.actor.userId, role: 'admin' })
      .execute();
    const act = (body: object) =>
      client
        .post('/api/v1/admin/community/actions')
        .auth(admin.token, { type: 'bearer' })
        .send({ id: randomUUID(), reason: 'Wiki 治理验证', ...body });
    await client.post('/api/v1/admin/community/groups').auth(admin.token, { type: 'bearer' }).send({ name: 'Wiki 审核', boards: ['daily'], permissions: ['reports', 'content', 'users', 'wiki', 'history'], members: ['wiki_gov_mod'] }).expect(201);
    const draft = {
      id: 'wiki-gov',
      title: '测试词条',
      summary: '摘要',
      communities: ['daily'],
      sections: [{ h: '章节', p: '安全版本' }],
      quick: [],
      reference: '',
    };
    const save = (baseRevision: number, text: string) =>
      client
        .post('/api/v1/demo/operations')
        .auth(author.token, { type: 'bearer' })
        .send({
          id: randomUUID(),
          operations: [
            {
              type: 'wiki.save',
              wiki: { ...draft, sections: [{ h: '章节', p: text }] },
              baseRevision,
              reason: text,
              applied: [],
            },
          ],
        });
    await save(0, '安全版本').expect(201);
    await save(1, '敏感历史原文').expect(201);
    await save(2, '清理后的安全版本').expect(201);
    await act({ action: 'wiki.manage', target: draft.id, revision: 3, hidden: true }).expect(409);
    await act({ action: 'wiki.manage', target: draft.id, revision: 2, hidden: true }).expect(201);
    const publicView = await client.get('/api/v1/demo').expect(200);
    expect(JSON.stringify(publicView.body)).not.toContain('敏感历史原文');
    expect(publicView.body.content.wiki[0].history[1].hidden).toBe(true);
    const scopedView = await client
      .get('/api/v1/admin/community/items?section=wiki&board=daily')
      .auth(mod.token, { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(scopedView.body)).not.toContain('敏感历史原文');
    await client
      .post('/api/v1/admin/community/actions?board=daily')
      .auth(mod.token, { type: 'bearer' })
      .send({
        id: randomUUID(),
        reason: '尝试恢复敏感修订',
        action: 'wiki.manage',
        target: draft.id,
        revision: 2,
        hidden: false,
      })
      .expect(403);
    await act({ action: 'wiki.manage', target: draft.id, protection: 'trusted', hours: 24 }).expect(
      201,
    );
    await save(3, '新用户尝试').expect(403);
    const row = await h.db
      .selectFrom('demo_entities')
      .selectAll()
      .where('id', '=', 'wiki:' + draft.id)
      .executeTakeFirstOrThrow();
    await h.db
      .updateTable('demo_entities')
      .set({
        data: JSON.stringify({
          ...JSON.parse(row.data),
          protectionUntil: new Date(Date.now() - 1000).toISOString(),
        }),
      })
      .where('id', '=', row.id)
      .execute();
    await save(3, '到期后编辑').expect(201);
    await act({
      action: 'wiki.manage',
      target: draft.id,
      title: '新标题',
      quality: 'sources',
    }).expect(201);
    const renamed = (await client.get('/api/v1/demo')).body.content.wiki[0];
    expect(renamed.title).toBe('新标题');
    expect(renamed.previousTitles).toContain('测试词条');
  } finally {
    await h.close();
  }
});

it('limits daily reports, keeps retries idempotent at the limit, and expires community-scoped publishing restrictions', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const admin = await auth.register(
      { username: 'limits_admin', password: 'Governance tests 923!' },
      'admin',
    );
    const author = await auth.register(
      { username: 'limits_author', password: 'Governance tests 923!' },
      'author',
    );
    const reader = await auth.register(
      { username: 'limits_reader', password: 'Governance tests 923!' },
      'reader',
    );
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin.actor.userId, role: 'admin' })
      .execute();
    const publish = (id: string, community = 'daily') =>
      client
        .post('/api/v1/demo/operations')
        .auth(author.token, { type: 'bearer' })
        .send({
          id: randomUUID(),
          operations: [{ type: 'post.create', post: { id, title: id, body: '正文', community } }],
        });
    const penalty = randomUUID();
    await publish('local-participant').expect(201);
    await client
      .post('/api/v1/admin/community/actions?board=daily')
      .auth(admin.token, { type: 'bearer' })
      .send({
        id: penalty,
        reason: '仅限制本社区',
        action: 'penalty',
        target: author.actor.userId,
        capability: 'publish',
        hours: 1,
      })
      .expect(201);
    await publish('denied-local').expect(403);
    await publish('allowed-elsewhere', 'questions').expect(201);
    await h.db
      .updateTable('moderation_penalties')
      .set({ until_at: new Date(Date.now() - 1000) })
      .where('id', '=', penalty)
      .execute();
    await publish('allowed-after-expiry').expect(201);
    const governance = await client
      .get('/api/v1/governance')
      .auth(author.token, { type: 'bearer' })
      .expect(200);
    expect(governance.body.actions.find((a: { id: string }) => a.id === penalty).status).toBe(
      'expired',
    );
    await client
      .post('/api/v1/demo/operations')
      .auth(author.token, { type: 'bearer' })
      .send({
        id: randomUUID(),
        operations: Array.from({ length: 21 }, (_, i) => ({
          type: 'post.create',
          post: { id: 'limit-' + i, title: '举报上限验证', body: '正文', community: 'daily' },
        })),
      })
      .expect(201);
    const report = (i: number) =>
      client
        .post('/api/v1/governance/reports')
        .auth(reader.token, { type: 'bearer' })
        .send({ target: 'post:limit-' + i, category: 'spam', detail: '' });
    let first = '';
    for (let i = 0; i < 20; i++) {
      const result = await report(i).expect(201);
      if (i === 0) first = result.body.id;
    }
    expect((await report(20).expect(403)).body.message).toBe('REPORT_DAILY_LIMIT');
    expect((await report(0).expect(201)).body.id).toBe(first);
  } finally {
    await h.close();
  }
});
