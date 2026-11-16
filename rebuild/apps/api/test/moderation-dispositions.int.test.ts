import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';

it('combines deletion and participation, independently reviews effects and preserves later restrictions', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const [admin, reviewer, mod, author, reporter] = await Promise.all(
      [
        'disposition_admin',
        'disposition_reviewer',
        'disposition_mod',
        'disposition_author',
        'disposition_reporter',
      ].map((username) =>
        auth.register({ username, password: 'Disposition tests 923!' }, username),
      ),
    );
    for (const account of [admin!, reviewer!])
      await h.db
        .insertInto('platform_roles')
        .values({ user_id: account.actor.userId, role: 'admin' })
        .execute();
    await client
      .post('/api/v1/admin/community/groups')
      .auth(admin!.token, { type: 'bearer' })
      .send({
        name: '处置版主',
        boards: ['daily'],
        permissions: ['reports', 'content', 'users', 'appeals.review', 'history'],
        members: ['disposition_mod'],
      })
      .expect(201);
    const act = (body: object, token = admin!.token, board = '') =>
      client
        .post('/api/v1/admin/community/actions' + (board ? '?board=' + board : ''))
        .auth(token, { type: 'bearer' })
        .send({ id: randomUUID(), reason: '处置集成测试', ...body });
    const send = (operations: object[]) =>
      client
        .post('/api/v1/demo/operations')
        .auth(author!.token, { type: 'bearer' })
        .send({ id: randomUUID(), operations });
    await send(
      ['daily', 'market'].map((community) => ({
        type: 'post.create',
        post: { id: 'disposition-' + community, title: '处置测试', body: '正文', community },
      })),
    ).expect(201);
    const report = await client
      .post('/api/v1/governance/reports')
      .auth(reporter!.token, { type: 'bearer' })
      .send({ target: 'post:disposition-daily', category: 'spam', detail: '重复广告' })
      .expect(201);
    const operationId = randomUUID();
    const disposition = {
      kind: 'participation',
      scope: 'community',
      board: 'daily',
      hours: null,
      expectedVersion: null,
    };
    const resolve = {
      id: operationId,
      action: 'case.resolve',
      target: 'post:disposition-daily',
      reportIds: [report.body.id],
      outcome: 'handled',
      hidden: true,
      authorDisposition: disposition,
    };
    await act(resolve, mod!.token, 'daily').expect(201);
    await act(resolve, mod!.token, 'daily').expect(201);
    expect(
      await h.db.selectFrom('admin_actions').selectAll().where('id', '=', operationId).execute(),
    ).toHaveLength(1);
    const effects = await h.db
      .selectFrom('moderation_action_effects')
      .selectAll()
      .where('action_id', '=', operationId)
      .execute();
    expect(effects).toHaveLength(2);
    await send([{ type: 'post.vote', postId: 'disposition-market', value: true }]).expect(201);
    await send([
      {
        type: 'reply.create',
        postId: 'disposition-daily',
        reply: { id: 'blocked', body: '不能回复' },
      },
    ]).expect(403);
    const appeal = await client
      .post('/api/v1/governance/appeals')
      .auth(author!.token, { type: 'bearer' })
      .send({ actionId: operationId, reason: '请求复核两项' })
      .expect(201);
    const nextId = randomUUID();
    await act(
      {
        id: nextId,
        action: 'disposition',
        target: author!.actor.userId,
        disposition: { ...disposition, hours: 720, expectedVersion: operationId },
      },
      mod!.token,
      'daily',
    ).expect(201);
    await act(
      {
        action: 'disposition',
        target: author!.actor.userId,
        disposition: { ...disposition, hours: 24, expectedVersion: operationId },
      },
      mod!.token,
      'daily',
    ).expect(409);
    const review = {
      action: 'appeal.review',
      target: appeal.body.id,
      outcome: 'reversed',
      decisions: effects.map((effect) => ({ effectId: effect.id, outcome: 'reversed' })),
    };
    await act(review, mod!.token, 'daily').expect(403);
    await act(review, reviewer!.token).expect(201);
    expect(
      (
        await h.db
          .selectFrom('admin_visibility')
          .selectAll()
          .where('target', '=', 'post:disposition-daily')
          .executeTakeFirstOrThrow()
      ).hidden,
    ).toBe(0);
    expect(
      (
        await h.db
          .selectFrom('moderation_penalties')
          .selectAll()
          .where('id', '=', nextId)
          .executeTakeFirstOrThrow()
      ).revoked_at,
    ).toBeNull();
    await send([{ type: 'post.vote', postId: 'disposition-daily', value: true }]).expect(403);
    await act(
      { action: 'penalty.revoke', target: nextId, expectedVersion: nextId },
      mod!.token,
      'daily',
    ).expect(201);
    await send([{ type: 'post.vote', postId: 'disposition-daily', value: true }]).expect(201);
    const restricted = await client
      .get('/api/v1/admin/community/items?section=users&board=daily&status=restricted')
      .auth(mod!.token, { type: 'bearer' })
      .expect(200);
    expect(restricted.body.total).toBe(0);
    await act({
      action: 'disposition',
      target: author!.actor.userId,
      disposition: { kind: 'deactivation', scope: 'global', hours: 24, expectedVersion: null },
    }).expect(201);
    await auth.login(
      { username: 'disposition_author', password: 'Disposition tests 923!' },
      'restricted-login',
    );
    await client.get('/api/v1/account').auth(author!.token, { type: 'bearer' }).expect(200);
    await client
      .post('/api/v1/account/profile')
      .auth(author!.token, { type: 'bearer' })
      .send({ nickname: '禁止修改' })
      .expect(403);
    const governance = await client
      .get('/api/v1/governance')
      .auth(author!.token, { type: 'bearer' })
      .expect(200);
    expect(governance.body.suspended).toBe(true);
    expect(
      governance.body.actions.some((item: { effects?: unknown[] }) => item.effects?.length),
    ).toBe(true);
    await send([{ type: 'post.vote', postId: 'disposition-market', value: true }]).expect(403);
  } finally {
    await h.close();
  }
});

it('routes mixed-scope appeals, supports partial outcomes and rejects stale concurrent changes', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const [admin, reviewer, mod, author, reporter] = await Promise.all(
      ['mixed_admin', 'mixed_reviewer', 'mixed_mod', 'mixed_author', 'mixed_reporter'].map(
        (username) => auth.register({ username, password: 'Disposition tests 923!' }, username),
      ),
    );
    for (const account of [admin!, reviewer!])
      await h.db
        .insertInto('platform_roles')
        .values({ user_id: account.actor.userId, role: 'admin' })
        .execute();
    await client
      .post('/api/v1/admin/community/groups')
      .auth(admin!.token, { type: 'bearer' })
      .send({
        name: '社区复核员',
        boards: ['daily'],
        permissions: ['reports', 'content', 'users', 'appeals.review', 'history'],
        members: ['mixed_mod'],
      })
      .expect(201);
    const act = (body: object, token = admin!.token, board = '') =>
      client
        .post('/api/v1/admin/community/actions' + (board ? '?board=' + board : ''))
        .auth(token, { type: 'bearer' })
        .send({ id: randomUUID(), reason: '组合复核测试', ...body });
    const disposition = {
      kind: 'participation',
      scope: 'global',
      hours: 168,
      expectedVersion: null,
    };
    for (const [index, outcomes] of [
      ['upheld', 'upheld'],
      ['reversed', 'upheld'],
      ['upheld', 'reversed'],
      ['reversed', 'reversed'],
    ].entries()) {
      const postId = 'partial-' + index;
      await client
        .post('/api/v1/demo/operations')
        .auth(author!.token, { type: 'bearer' })
        .send({
          id: randomUUID(),
          operations: [
            {
              type: 'post.create',
              post: { id: postId, title: '组合复核', body: '正文', community: 'daily' },
            },
          ],
        })
        .expect(201);
      const report = await client
        .post('/api/v1/governance/reports')
        .auth(reporter!.token, { type: 'bearer' })
        .send({ target: 'post:' + postId, category: 'spam' })
        .expect(201);
      const actionId = randomUUID();
      const resolve = {
        id: actionId,
        action: 'case.resolve',
        target: 'post:' + postId,
        reportIds: [report.body.id],
        outcome: 'handled',
        hidden: true,
        authorDisposition: disposition,
      };
      await act({
        ...resolve,
        authorDisposition: { ...disposition, scope: 'community', board: 'market' },
      }).expect(403);
      expect(
        await h.db
          .selectFrom('admin_visibility')
          .selectAll()
          .where('target', '=', 'post:' + postId)
          .execute(),
      ).toHaveLength(0);
      await act(resolve).expect(201);
      const appeal = await client
        .post('/api/v1/governance/appeals')
        .auth(author!.token, { type: 'bearer' })
        .send({ actionId, reason: '分别复核内容和限制' })
        .expect(201);
      const modQueue = await client
        .get('/api/v1/admin/community/items?section=appeals&board=daily')
        .auth(mod!.token, { type: 'bearer' })
        .expect(200);
      expect(modQueue.body.items.some((item: { id: string }) => item.id === appeal.body.id)).toBe(
        false,
      );
      await act(
        { action: 'appeal.review', target: appeal.body.id, outcome: 'reversed' },
        mod!.token,
        'daily',
      ).expect(403);
      const effects = await h.db
        .selectFrom('moderation_action_effects')
        .selectAll()
        .where('action_id', '=', actionId)
        .execute();
      await act(
        {
          action: 'appeal.review',
          target: appeal.body.id,
          outcome: 'upheld',
          decisions: effects.map((effect) => ({
            effectId: effect.id,
            outcome: outcomes[effect.type === 'content.delete' ? 0 : 1],
          })),
        },
        reviewer!.token,
      ).expect(201);
      const state = await h.db
        .selectFrom('moderation_appeals')
        .selectAll()
        .where('id', '=', appeal.body.id)
        .executeTakeFirstOrThrow();
      expect(state.status).toBe(outcomes[0] === outcomes[1] ? outcomes[0] : 'partial');
      expect(
        (
          await h.db
            .selectFrom('admin_visibility')
            .selectAll()
            .where('target', '=', 'post:' + postId)
            .executeTakeFirstOrThrow()
        ).hidden,
      ).toBe(outcomes[0] === 'reversed' ? 0 : 1);
      const penalty = await h.db
        .selectFrom('moderation_penalties')
        .selectAll()
        .where('id', '=', actionId)
        .executeTakeFirstOrThrow();
      expect(Boolean(penalty.revoked_at)).toBe(outcomes[1] === 'reversed');
      if (!penalty.revoked_at)
        await act({ action: 'penalty.revoke', target: actionId, expectedVersion: actionId }).expect(
          201,
        );
    }
    const initial = randomUUID();
    await act({
      id: initial,
      action: 'disposition',
      target: author!.actor.userId,
      disposition,
    }).expect(201);
    const updates = await Promise.all(
      [24, 720].map((hours) =>
        act({
          action: 'disposition',
          target: author!.actor.userId,
          disposition: { ...disposition, hours, expectedVersion: initial },
        }),
      ),
    );
    expect(updates.map((result) => result.status).sort()).toEqual([201, 409]);
    const current = await h.db
      .selectFrom('moderation_penalties')
      .selectAll()
      .where('user_id', '=', author!.actor.userId)
      .where('revoked_at', 'is', null)
      .where('superseded_by', 'is', null)
      .execute();
    expect(current).toHaveLength(1);
    await client
      .post('/api/v1/demo/operations')
      .auth(author!.token, { type: 'bearer' })
      .send({
        id: randomUUID(),
        operations: [
          { type: 'profile.save', profile: { name: 'mixed_author', bio: '允许维护资料' } },
          { type: 'post.vote', postId: 'partial-1', value: true },
        ],
      })
      .expect(403);
    await act({ action: 'penalty.revoke', target: current[0]!.id }).expect(201);
    await act({
      action: 'disposition',
      target: author!.actor.userId,
      disposition: { ...disposition, kind: 'warning' },
    }).expect(201);
    const users = await client
      .get('/api/v1/admin/community/items?section=users&status=restricted')
      .auth(admin!.token, { type: 'bearer' })
      .expect(200);
    expect(users.body.total).toBe(0);
  } finally {
    await h.close();
  }
});
