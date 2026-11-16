import { respondModeratorInvitation } from '../src/modules/admin/moderator-invitations.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { migrate } from '../src/database/migrate.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { moderatorGroupId, moderationOperations } from '../../../packages/contracts/src/admin.js';

it('manages default and custom groups, atomic members, granular grants, independent appeals and ownership', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const accounts = await Promise.all(
      ['owner', 'admin', 'mod', 'reader', 'author', 'next'].map((name) =>
        auth.register({ username: 'groups_' + name, password: 'Group redesign 123!' }, name),
      ),
    );
    const [owner, admin, mod, reader, author, next] = accounts;
    await h.db
      .insertInto('platform_roles')
      .values([
        { user_id: owner!.actor.userId, role: 'owner' },
        { user_id: admin!.actor.userId, role: 'admin' },
      ])
      .execute();
    await h.db.insertInto('runtime_settings').values({ id: 'community-application-policy', value: '{"days":0,"posts":0}', revision: 1, updated_at: new Date() }).execute();
    const accept = async (userId: string, board: string) => {
      const invitation = await h.db.selectFrom('community_requests').selectAll().where('kind', '=', 'moderator_invitation').where('user_id', '=', userId).where('board', '=', board).where('state', '=', 'pending').executeTakeFirstOrThrow();
      await respondModeratorInvitation(h.db, userId, { id: invitation.id, version: invitation.version, action: 'accept' });
    };
    const base = '/api/v1/admin/community/';
    const post = (path: string, body: object, token = owner!.token) =>
      client
        .post(base + path)
        .auth(token, { type: 'bearer' })
        .send(body);
    const get = (path: string, token = owner!.token) =>
      client.get(base + path).auth(token, { type: 'bearer' });
    const act = (body: object, token = owner!.token, board?: string) =>
      post(
        'actions' + (board ? '?board=' + board : ''),
        { id: randomUUID(), reason: '测试权限边界', ...body },
        token,
      );
    const initial = (await get('groups').expect(200)).body;
    expect(initial.map((g: { name: string }) => g.name)).toEqual([
      '普通用户',
      '全站管理员',
      '版主',
    ]);
    expect(initial[2]).toMatchObject({ id: moderatorGroupId, boards: [], members: [] });
    await post('groups', {
      id: moderatorGroupId,
      name: '版主',
      boards: ['daily'],
      permissions: [...moderationOperations],
    }).expect(201);
    await post('groups/members', {
      groupId: moderatorGroupId,
      userIds: [mod!.actor.userId, randomUUID()],
      member: true,
      boards: ['daily'],
    }).expect(404);
    expect((await get('groups').expect(200)).body[2].members).toEqual([]);
    await post('groups/members', {
      groupId: moderatorGroupId,
      userIds: [mod!.actor.userId],
      member: true,
      boards: ['daily'],
    }).expect(201);
    await post('groups', {
      id: moderatorGroupId,
      name: '版主',
      boards: ['daily'],
      permissions: [...moderationOperations],
    }).expect(201);
    await accept(mod!.actor.userId, 'daily');
    expect((await get('groups').expect(200)).body[2].members).toEqual(['groups_mod']);
    await post('groups/members', { groupId: moderatorGroupId, userIds: [author!.actor.userId], member: true, boards: ['market'] }).expect(201);
    await accept(author!.actor.userId, 'market');
    await get('items?section=reports&board=market', author!.token).expect(200);
    await get('items?section=reports&board=daily', author!.token).expect(403);
    await get('items?section=reports&board=market', mod!.token).expect(403);
    await post('groups/boards', { userIds: [author!.actor.userId], boards: ['daily'] }, mod!.token).expect(403);
    await post('groups/boards', { userIds: [author!.actor.userId, randomUUID()], boards: ['market'] }).expect(404);
    await get('items?section=reports&board=market', author!.token).expect(200);
    await post('groups/boards', { userIds: [author!.actor.userId], boards: ['daily'] }).expect(409);
    await post('groups/boards', { userIds: [author!.actor.userId], boards: ['questions'] }).expect(201);
    await accept(author!.actor.userId, 'questions');
    await get('items?section=reports&board=market', author!.token).expect(403);
    await get('items?section=reports&board=questions', author!.token).expect(200);
    await post('groups', { id: moderatorGroupId, name: '版主', boards: ['resources'], permissions: [...moderationOperations] }).expect(201);
    await get('items?section=reports&board=resources', mod!.token).expect(403);
    await get('items?section=reports&board=daily', mod!.token).expect(200);
    await post('groups/boards', { userIds: [author!.actor.userId], boards: [] }).expect(201);
    expect((await get('access', author!.token)).body.boards).toEqual([]);
    await post('groups/members', { groupId: moderatorGroupId, userIds: [author!.actor.userId], member: false }).expect(201);
    const custom = (
      await post('groups', {
        name: '只读审核',
        boards: ['daily'],
        permissions: ['reports.view'],
        members: ['groups_reader'],
      }).expect(201)
    ).body.id;
    await get('items?section=reports&board=daily', reader!.token).expect(200);
    await act({ action: 'case.escalate', target: 'post:unknown' }, reader!.token, 'daily').expect(
      403,
    );
    await act(
      { action: 'visibility', target: 'post:unknown', hidden: true },
      reader!.token,
      'daily',
    ).expect(403);
    await get('items?section=reports&board=market', reader!.token).expect(403);
    const grant = (
      await post('groups', {
        name: '删除协助',
        boards: ['daily'],
        permissions: ['content.delete'],
        members: ['groups_reader'],
      }).expect(201)
    ).body.id;
    const access = (await get('access', reader!.token)).body;
    expect(access.boards[0].permissions).toEqual(
      expect.arrayContaining(['reports.view', 'content.view', 'content.delete']),
    );
    await act(
      { action: 'visibility', target: 'post:unknown', hidden: false },
      reader!.token,
      'daily',
    ).expect(403);
    const emptyGroup = (
      await post('groups', { name: '空群组', boards: [], permissions: [] }).expect(201)
    ).body.id;
    await Promise.all([
      post('groups/members', {
        groupId: emptyGroup,
        userIds: [reader!.actor.userId],
        member: true,
      }).expect(201),
      post('groups/members', {
        groupId: emptyGroup,
        userIds: [author!.actor.userId],
        member: true,
      }).expect(201),
      post('groups', { id: emptyGroup, name: '空群组', boards: [], permissions: [] }).expect(201),
    ]);
    await migrate(h.db);
    expect(
      (await get('groups').expect(200)).body.find(
        (group: { id: string }) => group.id === emptyGroup,
      ).members,
    ).toEqual(['groups_author', 'groups_reader']);
    expect((await get('access', author!.token)).body.boards).toEqual([]);
    await get('groups', mod!.token).expect(403);
    await get('items?section=team&board=daily', mod!.token).expect(403);
    await post('groups/delete', { id: moderatorGroupId }).expect(409);
    await post('groups/delete', { id: grant }, mod!.token).expect(403);
    await post('groups/delete', { id: grant }).expect(201);
    await get('items?section=content&board=daily', reader!.token).expect(403);
    await post(
      'groups/members',
      { groupId: 'admin', userIds: [next!.actor.userId], member: true },
      admin!.token,
    ).expect(403);
    await post('groups/members', {
      groupId: 'admin',
      userIds: [next!.actor.userId],
      member: true,
    }).expect(201);
    await post('groups/members', {
      groupId: 'admin',
      userIds: [owner!.actor.userId],
      member: false,
    }).expect(409);
    await act(
      { action: 'penalty', target: admin!.actor.userId, capability: 'publish', hours: 24 },
      next!.token,
    ).expect(403);
    await act({
      action: 'penalty',
      target: admin!.actor.userId,
      capability: 'publish',
      hours: 24,
    }).expect(201);
    await act({
      action: 'penalty',
      target: owner!.actor.userId,
      capability: 'publish',
      hours: 24,
    }).expect(403);
    await act(
      { action: 'penalty', target: reader!.actor.userId, capability: 'publish', hours: 24 },
      mod!.token,
      'daily',
    ).expect(403);
    await client
      .post('/api/v1/demo/operations')
      .auth(author!.token, { type: 'bearer' })
      .send({
        id: randomUUID(),
        operations: [
          {
            type: 'post.create',
            post: { id: 'group-author', title: '社区参与', body: '正文', community: 'daily' },
          },
        ],
      })
      .expect(201);
    const penaltyId = randomUUID();
    await act(
      {
        id: penaltyId,
        action: 'penalty',
        target: author!.actor.userId,
        capability: 'publish',
        hours: 24,
      },
      mod!.token,
      'daily',
    ).expect(201);
    const appeal = await client
      .post('/api/v1/governance/appeals')
      .auth(author!.token, { type: 'bearer' })
      .send({ actionId: penaltyId, reason: '请求复核' })
      .expect(201);
    await get('items?section=appeals&board=daily', mod!.token).expect(200);
    await act(
      { action: 'appeal.review', target: appeal.body.id, outcome: 'reversed' },
      mod!.token,
      'daily',
    ).expect(403);
    const reviewGroup = (
      await post('groups', {
        name: '独立复核',
        boards: ['daily'],
        permissions: ['appeals.review'],
        members: ['groups_next'],
      }).expect(201)
    ).body.id;
    await post('groups/members', {
      groupId: 'admin',
      userIds: [next!.actor.userId],
      member: false,
    }).expect(201);
    await act(
      { action: 'appeal.review', target: appeal.body.id, outcome: 'reversed' },
      next!.token,
      'daily',
    ).expect(201);
    expect(
      (
        await h.db
          .selectFrom('moderation_penalties')
          .selectAll()
          .where('id', '=', penaltyId)
          .executeTakeFirstOrThrow()
      ).revoked_at,
    ).not.toBeNull();
    await post('ownership/transfer', { userId: next!.actor.userId }, admin!.token).expect(403);
    await post('ownership/transfer', { userId: next!.actor.userId }).expect(201);
    expect((await get('access')).body).toMatchObject({ admin: true, owner: false });
    expect((await get('access', next!.token)).body).toMatchObject({ admin: true, owner: true });
    await post('groups/delete', { id: custom }).expect(201);
    await post('groups/delete', { id: reviewGroup }).expect(201);
  } finally {
    await h.close();
  }
});
