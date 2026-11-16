import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';

it('filters users and reports, and enforces group membership, capability and community together', async () => {
  const h = await createTestApp();
  try {
    const client = request(h.app.getHttpServer());
    const auth = new PasswordAuthService(h.db);
    const register = (username: string) =>
      auth.register({ username, password: 'Moderation tests 123!' }, username);
    const admin = await register('test_group_admin');
    const reviewer = await register('test_group_reviewer');
    const author = await register('test_group_author');
    const origin = '/api/v1/admin/community/';
    const get = (path: string, token = admin.token) =>
      client.get(origin + path).auth(token, { type: 'bearer' });
    const post = (path: string, body: object, token = admin.token) =>
      client
        .post(origin + path)
        .auth(token, { type: 'bearer' })
        .send(body);
    const act = (body: object, token = admin.token, board?: string) =>
      post(
        'actions' + (board ? '?board=' + board : ''),
        {
          id: randomUUID(),
          reason: '验证群组权限',
          ...body,
        },
        token,
      );
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin.actor.userId, role: 'admin' })
      .execute();
    const everyone = (await get('groups').expect(200)).body.find(
      (entry: { id: string }) => entry.id === 'everyone',
    );
    expect(everyone).toMatchObject({ name: '普通用户', builtin: true, permissions: [] });
    expect(everyone.members).toEqual(
      expect.arrayContaining(['test_group_admin', 'test_group_reviewer', 'test_group_author']),
    );
    await register('test_group_newmember');
    expect(
      (await get('groups').expect(200)).body.find(
        (entry: { id: string }) => entry.id === 'everyone',
      ).members,
    ).toContain('test_group_newmember');
    const group = {
      name: '举报志愿者',
      boards: ['daily'],
      permissions: ['reports'],
      members: ['test_group_reviewer'],
    };
    await post('groups', group, reviewer.token).expect(403);
    const id = (await post('groups', group).expect(201)).body.id;
    expect((await get('groups').expect(200)).body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, ...group, permissions: ['reports.view', 'reports.dismiss', 'reports.escalate'] })]),
    );
    const authorMembership = { groupId: id, userId: author.actor.userId, member: true };
    await post('membership', authorMembership, reviewer.token).expect(403);
    await post('membership', authorMembership).expect(201);
    await post('membership', authorMembership).expect(201);
    await get('items?section=reports&board=daily', author.token).expect(200);
    await post('groups', { ...group, id, expectedMembers: group.members }).expect(409);
    await post('membership', { ...authorMembership, member: false }).expect(201);
    await get('items?section=reports&board=daily', author.token).expect(403);
    expect(
      (await get('items?section=history').expect(200)).body.items.filter(
        (item: { kind: string }) => item.kind === 'group.member',
      ),
    ).toHaveLength(2);
    await get('items?section=reports&board=daily', reviewer.token).expect(200);
    await get('items?section=reports', reviewer.token).expect(403);
    await get('items?section=reports&board=market', reviewer.token).expect(403);
    await get('items?section=users&board=daily', reviewer.token).expect(403);
    await get('context?board=daily&user=' + author.actor.userId, reviewer.token).expect(403);
    await client
      .post('/api/v1/demo/operations')
      .auth(author.token, { type: 'bearer' })
      .send({
        id: randomUUID(),
        operations: [
          {
            type: 'post.create',
            post: { id: 'group-test', title: '群组测试帖', body: '测试正文', community: 'daily' },
          },
        ],
      })
      .expect(201);
    await client
      .post('/api/v1/governance/reports')
      .auth(reviewer.token, { type: 'bearer' })
      .send({ target: 'post:group-test', category: 'spam', detail: '重复发布推广内容' })
      .expect(201);
    const reports = (
      await get(
        'items?section=reports&status=pending&kind=post&board=daily',
        reviewer.token,
      ).expect(200)
    ).body.items;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      publishedAt: expect.any(String),
      contentHidden: false,
      reporterId: '',
      reports: [
        {
          reporter: '匿名举报人',
          reporterId: '',
          categoryLabel: expect.any(String),
          detail: '重复发布推广内容',
          createdAt: expect.any(String),
        },
      ],
    });
    const record = encodeURIComponent(reports[0].id);
    const detailPath = 'items?section=reports&board=daily&record=' + record;
    expect((await get(detailPath, reviewer.token).expect(200)).body.items).toHaveLength(1);
    await get(detailPath, author.token).expect(403);
    const adminDetail = await get('items?section=reports&record=' + record).expect(200);
    expect(adminDetail.body.items[0].reports[0].reporterId).toBe(reviewer.actor.userId);
    await act({ action: 'visibility', target: 'post:group-test', hidden: true }).expect(201);
    expect(
      (await get('items?section=reports&record=' + record).expect(200)).body.items[0],
    ).toMatchObject({ status: 'pending', contentHidden: true });
    await act({ action: 'visibility', target: 'post:group-test', hidden: false }).expect(201);
    expect(
      (await get('items?section=reports&kind=user&board=daily', reviewer.token).expect(200)).body
        .total,
    ).toBe(0);
    const resolution = {
      action: 'case.resolve',
      target: reports[0].target,
      reportIds: reports[0].reportIds,
      outcome: 'handled',
    };
    await act({ ...resolution, hidden: true }, reviewer.token, 'daily').expect(403);
    await act({ ...resolution, hours: 24 }, reviewer.token, 'daily').expect(403);
    await act({ ...resolution, hidden: true }).expect(201);
    await get('items?section=trash&board=daily', reviewer.token).expect(403);
    await post('groups', { ...group, id, permissions: ['content'] }).expect(201);
    await get('items?section=reports&board=daily', reviewer.token).expect(403);
    const trash = await get('items?section=trash&board=daily', reviewer.token).expect(200);
    expect(trash.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 'post:group-test' })]),
    );
    await act(
      { action: 'visibility', target: 'post:group-test', hidden: false },
      reviewer.token,
      'daily',
    ).expect(201);
    const restored = await get('items?section=reports&record=' + record).expect(200);
    expect(restored.body.items[0]).toMatchObject({
      status: 'handled',
      contentHidden: false,
      restorations: [expect.objectContaining({ author: 'test_group_reviewer' })],
    });
    const accountTarget = 'account:' + author.actor.userId;
    const accountReport = await client
      .post('/api/v1/governance/reports')
      .auth(reviewer.token, { type: 'bearer' })
      .send({ target: accountTarget, category: 'spam' })
      .expect(201);
    const accountRecord =
      'items?section=reports&record=' + encodeURIComponent(accountReport.body.id);
    await post('groups', { ...group, id, permissions: ['reports', 'users'] }).expect(201);
    expect(
      (await get(accountRecord + '&board=daily', reviewer.token).expect(200)).body.items,
    ).toHaveLength(1);
    const accountResolution = {
      action: 'case.resolve',
      target: accountTarget,
      reportIds: [accountReport.body.id],
      outcome: 'handled',
      accountPenalty: { capability: 'publish', hours: 24 },
    };
    await act(accountResolution, reviewer.token, 'daily').expect(403);
    await act(
      { action: 'case.escalate', target: accountTarget, reason: '' },
      reviewer.token,
      'daily',
    ).expect(201);
    const escalated = await get(accountRecord + '&board=daily', reviewer.token).expect(200);
    expect(escalated.body.items[0].status).toBe('escalated');
    await act(accountResolution).expect(201);
    expect((await get(accountRecord).expect(200)).body.items[0].status).toBe('handled');
    await post('groups', { ...group, id, members: [] }).expect(201);
    await get('items?section=reports&board=daily', reviewer.token).expect(403);
    const usernames = async (status: string) =>
      (await get('items?section=users&status=' + status).expect(200)).body.items.map(
        (user: { handle: string }) => user.handle,
      );
    expect(await usernames('active')).toContain('test_group_author');
    expect(await usernames('new')).toContain('test_group_author');
    expect(await usernames('staff')).toEqual(['test_group_admin']);
    await act({
      action: 'penalty',
      target: author.actor.userId,
      capability: 'publish',
      hours: 24,
    }).expect(201);
    await act({
      action: 'penalty',
      target: author.actor.userId,
      capability: 'suspension',
      hours: 24,
    }).expect(201);
    expect(await usernames('muted')).toEqual(['test_group_author']);
    expect(await usernames('suspended')).toEqual(['test_group_author']);
  } finally {
    await h.close();
  }
});
