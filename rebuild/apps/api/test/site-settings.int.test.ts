import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import type { SiteSettingsSnapshot } from '../../../packages/contracts/src/site-settings.js';

it('publishes settings by scope and schedule, rejects stale updates, and retains the original report label', async () => {
  const test = await createTestApp();
  const client = request(test.app.getHttpServer());
  const adminPath = '/api/v1/admin/community/site-settings';
  const publicPath = '/api/v1/demo/site-settings';
  const initial = await test.db
    .selectFrom('runtime_settings')
    .selectAll()
    .where('id', '=', 'site-settings')
    .executeTakeFirstOrThrow();
  try {
    const auth = new PasswordAuthService(test.db);
    const admin = await auth.register(
      { username: 'settings_admin', password: 'Site setting tests 123!' },
      'settings-admin',
    );
    const member = await auth.register(
      { username: 'settings_member', password: 'Site setting tests 123!' },
      'settings-member',
    );
    await test.db
      .insertInto('platform_roles')
      .values({ user_id: admin.actor.userId, role: 'admin' })
      .execute();
    await client.get(adminPath).expect(401);
    await client.get(adminPath).auth(member.token, { type: 'bearer' }).expect(403);
    const original: SiteSettingsSnapshot = (
      await client.get(adminPath).auth(admin.token, { type: 'bearer' }).expect(200)
    ).body;
    const updated = structuredClone(original);
    const future = new Date(Date.now() + 86400000).toISOString();
    const expired = new Date(Date.now() - 86400000).toISOString();
    updated.settings.site.title = '校园社区';
    updated.settings.boards.market.prompt = '填写校内交接点';
    updated.settings.announcements = [
      {
        id: randomUUID(),
        title: '当前公告',
        body: '已发布',
        boards: ['market'],
        enabled: true,
        startsAt: null,
        endsAt: null,
      },
      {
        id: randomUUID(),
        title: '未来公告',
        body: '尚未发布',
        boards: [],
        enabled: true,
        startsAt: future,
        endsAt: null,
      },
      {
        id: randomUUID(),
        title: '过期公告',
        body: '已结束',
        boards: [],
        enabled: true,
        startsAt: null,
        endsAt: expired,
      },
    ];
    updated.settings.reportReasons.unshift({
      id: 'market-risk',
      label: '交接风险',
      boards: ['market'],
      enabled: true,
    });
    const save = (value: SiteSettingsSnapshot, token = admin.token) =>
      client.post(adminPath).auth(token, { type: 'bearer' }).send(value);
    await save(updated, member.token).expect(403);
    const saved: SiteSettingsSnapshot = (await save(updated).expect(201)).body;
    await save(updated).expect(409);
    const published = (await client.get(publicPath).expect(200)).body;
    expect(published.site.title).toBe('校园社区');
    expect(published.boards.market.prompt).toBe('填写校内交接点');
    expect(published.announcements.map((item: { title: string }) => item.title)).toEqual([
      '当前公告',
    ]);
    expect(published.refreshAfterMs).toBeGreaterThan(0);
    await client
      .post('/api/v1/demo/operations')
      .auth(admin.token, { type: 'bearer' })
      .send({
        id: randomUUID(),
        operations: (['market', 'daily'] as const).map((community) => ({
          type: 'post.create',
          post: { id: 'site-settings-' + community, community, title: '测试帖子', body: '正文' },
        })),
      })
      .expect(201);
    const report = (board: string, category: string) =>
      client
        .post('/api/v1/governance/reports')
        .auth(member.token, { type: 'bearer' })
        .send({ target: 'post:site-settings-' + board, category });
    await report('daily', 'market-risk').expect(400);
    await report('market', 'market-risk').expect(201);
    saved.settings.reportReasons[0]!.label = '调整后的理由';
    saved.settings.reportReasons[0]!.enabled = false;
    await save(saved).expect(201);
    const current = (await client.get(publicPath).expect(200)).body;
    expect(
      current.reportReasons.some((reason: { id: string }) => reason.id === 'market-risk'),
    ).toBe(false);
    const list = (
      await client
        .get('/api/v1/admin/community/items?section=reports')
        .auth(admin.token, { type: 'bearer' })
        .expect(200)
    ).body;
    expect(list.items[0].reason).toBe('交接风险');
    const history = (
      await client
        .get('/api/v1/admin/community/items?section=history')
        .auth(admin.token, { type: 'bearer' })
        .expect(200)
    ).body;
    expect(
      history.items.filter((item: { kind: string }) => item.kind === 'settings.site'),
    ).toHaveLength(2);
  } finally {
    await test.db
      .updateTable('runtime_settings')
      .set({ value: initial.value, revision: initial.revision, updated_at: initial.updated_at })
      .where('id', '=', initial.id)
      .execute();
    await test.close();
  }
});
