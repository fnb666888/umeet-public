import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './support/test-app.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { CommunitiesService } from '../src/modules/communities/communities.service.js';
import { NewsService } from '../src/modules/community-interest/news.service.js';
import { ForecastsService } from '../src/modules/community-interest/forecasts.service.js';
import {
  isPublicAddress,
  validateSourceUrl,
  canonicalUrl,
} from '../src/modules/community-interest/source-fetch.js';
import { candidates } from '../src/modules/community-interest/news.service.js';

describe('interest community first version', () => {
  it('exposes news and forecasts as opt-in boards and keeps system publication separate from member posts', async () => {
    const h = await createTestApp();
    try {
      await new CommunitiesService(h.db).seedDefaults();
      const auth = new PasswordAuthService(h.db);
      const a = await auth.register(
        { username: 'content_board_a', password: 'Interest tests 82!' },
        'a',
      );
      const b = await auth.register(
        { username: 'content_board_b', password: 'Interest tests 82!' },
        'b',
      );
      const client = request(h.app.getHttpServer());
      const directory = await h.db
        .selectFrom('communities')
        .select(['slug', 'is_default'])
        .where('slug', 'in', ['news', 'forecasts'])
        .execute();
      expect(directory).toHaveLength(2);
      expect(directory.every((board) => !board.is_default)).toBe(true);
      const before = (
        await client.get('/api/v1/demo').auth(a.token, { type: 'bearer' }).expect(200)
      ).body;
      expect(before.userState.followedBoards).not.toContain('news');
      await client
        .post('/api/v1/demo/operations')
        .auth(a.token, { type: 'bearer' })
        .send({
          id: randomUUID(),
          operations: [
            {
              type: 'state.save',
              state: { followedBoards: [...before.userState.followedBoards, 'news', 'forecasts'] },
            },
          ],
        })
        .expect(201);
      const subscribed = (
        await client.get('/api/v1/demo').auth(a.token, { type: 'bearer' }).expect(200)
      ).body;
      expect(subscribed.userState.followedBoards).toContain('news');
      expect(subscribed.userState.followedBoards).toContain('forecasts');
      const other = (await client.get('/api/v1/demo').auth(b.token, { type: 'bearer' }).expect(200))
        .body;
      expect(other.userState.followedBoards).not.toContain('news');
      for (const board of ['news', 'forecasts'])
        await client
          .post('/api/v1/demo/operations')
          .auth(a.token, { type: 'bearer' })
          .send({
            id: randomUUID(),
            operations: [
              {
                type: 'post.create',
                post: {
                  id: 'p' + randomUUID(),
                  community: board,
                  title: 'Should not be a system publication',
                  body: 'Test',
                  author: 'a',
                  likes: 0,
                },
              },
            ],
          })
          .expect(403);
    } finally {
      await h.close();
    }
  });
  it('requires explicit board selection, preserves prior subscriptions and isolates account preferences', async () => {
    const h = await createTestApp();
    try {
      await new CommunitiesService(h.db).seedDefaults();
      const auth = new PasswordAuthService(h.db);
      const a = await auth.register(
          { username: 'interest_a', password: 'Interest tests 82!' },
          'a',
        ),
        b = await auth.register({ username: 'interest_b', password: 'Interest tests 82!' }, 'b');
      const client = request(h.app.getHttpServer());
      const boards = await h.db
        .selectFrom('communities')
        .select(['slug', 'is_default'])
        .where('slug', 'in', ['ai', 'technology', 'opensource', 'web3'])
        .execute();
      expect(boards).toHaveLength(4);
      expect(boards.every((v) => v.is_default === 0)).toBe(true);
      const settings = await new SettingsService(h.db).getPublicSiteSettings();
      expect(settings.boards['ai']!.posting.readonly).toBe(false);
      const initial = (
        await client.get('/api/v1/demo').auth(a.token, { type: 'bearer' }).expect(200)
      ).body;
      expect(initial.userState.followedBoards).not.toContain('ai');
      await client
        .put('/api/v1/interest/preferences')
        .auth(a.token, { type: 'bearer' })
        .send({ onboarding: 'completed', boards: ['ai'], tags: ['模型'] })
        .expect(200);
      const state = (await client.get('/api/v1/demo').auth(a.token, { type: 'bearer' }).expect(200))
        .body;
      expect(state.userState.followedBoards).toContain('daily');
      expect(state.userState.followedBoards).toContain('ai');
      expect(
        (
          await client
            .get('/api/v1/interest/preferences')
            .auth(b.token, { type: 'bearer' })
            .expect(200)
        ).body.onboardingNeeded,
      ).toBe(true);
      await client
        .put('/api/v1/interest/preferences')
        .auth(b.token, { type: 'bearer' })
        .send({ onboarding: 'skipped', boards: [], tags: [] })
        .expect(200);
      expect(
        (
          await client
            .get('/api/v1/interest/preferences')
            .auth(b.token, { type: 'bearer' })
            .expect(200)
        ).body.onboardingNeeded,
      ).toBe(false);
      await client
        .put('/api/v1/interest/preferences')
        .send({ onboarding: 'skipped', boards: [], tags: [] })
        .expect(401);
    } finally {
      await h.close();
    }
  });
  it('freezes poll questions on the first vote, permits one current vote and never publishes voter identities', async () => {
    const h = await createTestApp();
    try {
      await new CommunitiesService(h.db).seedDefaults();
      const auth = new PasswordAuthService(h.db),
        a = await auth.register({ username: 'poll_a', password: 'Interest tests 82!' }, 'a'),
        b = await auth.register({ username: 'poll_b', password: 'Interest tests 82!' }, 'b');
      const client = request(h.app.getHttpServer()),
        postId = 'p' + randomUUID();
      await client
        .post('/api/v1/demo/operations')
        .auth(a.token, { type: 'bearer' })
        .send({
          id: randomUUID(),
          operations: [
            {
              type: 'post.create',
              post: {
                id: postId,
                community: 'ai',
                title: '模型体验投票',
                body: '实际使用后你更看重什么？',
                author: 'x',
                likes: 0,
              },
            },
          ],
        })
        .expect(201);
      expect((await client.get(`/api/v1/interest/polls/${postId}`).expect(200)).body).toEqual({
        poll: null,
      });
      const input = {
        postId,
        question: '你最看重哪一点？',
        options: ['可靠', '速度'],
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      };
      await client
        .post('/api/v1/interest/polls')
        .auth(b.token, { type: 'bearer' })
        .send(input)
        .expect(403);
      await client
        .post('/api/v1/interest/polls')
        .auth(a.token, { type: 'bearer' })
        .send(input)
        .expect(201);
      await client
        .put(`/api/v1/interest/polls/${postId}`)
        .auth(a.token, { type: 'bearer' })
        .send({ ...input, options: ['速度', '可靠'] })
        .expect(200);
      await client
        .post(`/api/v1/interest/polls/${postId}/vote`)
        .auth(b.token, { type: 'bearer' })
        .send({ option: 0, version: 1 })
        .expect(409);
      await Promise.all(
        [0, 1, 0].map((option) =>
          client
            .post(`/api/v1/interest/polls/${postId}/vote`)
            .auth(b.token, { type: 'bearer' })
            .send({ option, version: 2 })
            .expect(201),
        ),
      );
      const result = (await client.get(`/api/v1/interest/polls/${postId}`).expect(200)).body.poll;
      expect(result.total).toBe(1);
      expect(result.myVote).toBeNull();
      expect(JSON.stringify(result)).not.toContain(b.actor.userId);
      await client
        .put(`/api/v1/interest/polls/${postId}`)
        .auth(a.token, { type: 'bearer' })
        .send({ ...input, options: ['被修改', '速度'] })
        .expect(409);
      await client
        .post(`/api/v1/interest/polls/${postId}/cancel`)
        .auth(b.token, { type: 'bearer' })
        .send({})
        .expect(403);
      await h.db
        .updateTable('interest_polls')
        .set({ ends_at: new Date(Date.now() - 1000) })
        .where('post_id', '=', postId)
        .execute();
      await client
        .post(`/api/v1/interest/polls/${postId}/vote`)
        .auth(a.token, { type: 'bearer' })
        .send({ option: 0, version: 2 })
        .expect(409);
      await client
        .post(`/api/v1/interest/polls/${postId}/vote`)
        .send({ option: 0, version: 2 })
        .expect(401);
    } finally {
      await h.close();
    }
  });
  it('atomically limits daily news, deduplicates sources and preserves source metadata', async () => {
    const h = await createTestApp();
    try {
      const now = new Date('2030-01-01T08:00:00Z');
      for (const id of ['source-a', 'source-b'])
        await h.db
          .insertInto('interest_sources')
          .values({
            id,
            name: id,
            board: 'ai',
            kind: 'github',
            url: 'https://api.github.com/repos/example/project/releases',
            terms_url: 'https://docs.github.com/',
            enabled: 1,
            approved: 1,
            etag: null,
            last_error: '',
            fetched_at: null,
            due_at: now,
          })
          .execute();
      const news = new NewsService(h.db);
      const results = await Promise.all(
        Array.from({ length: 9 }, (_, i) =>
          news.publish(
            i % 2 ? 'source-a' : 'source-b',
            {
              externalId: String(i),
              title: '版本 ' + i,
              url: `https://github.com/example/project/releases/tag/v${i}`,
              summary: '',
              publishedAt: now,
              language: '',
            },
            now,
          ),
        ),
      );
      expect(results.filter((r) => r.state === 'published')).toHaveLength(5);
      expect((await news.list({})).items).toHaveLength(5);
      const first = (await news.list({})).items[0]!;
      expect(first.summary).toBe('');
      const duplicate = await news.publish(
        'source-a',
        {
          externalId: 'duplicate',
          title: '同一个版本',
          url: first.url + '?utm_source=duplicate',
          summary: '',
          publishedAt: now,
          language: '',
        },
        now,
      );
      expect(duplicate.state).toBe('duplicate');
      const quota = await h.db
        .selectFrom('interest_news_quotas')
        .select('count')
        .executeTakeFirstOrThrow();
      expect(quota.count).toBe(5);
    } finally {
      await h.close();
    }
  });
  it('publishes exactly one immutable daily prediction and appends independently verified results', async () => {
    const h = await createTestApp();
    try {
      const now = new Date('2030-02-01T00:00:00Z');
      await h.db
        .insertInto('interest_sources')
        .values({
          id: 'official',
          name: '官方版本',
          board: 'opensource',
          kind: 'github',
          url: 'https://api.github.com/repos/example/project/releases',
          terms_url: 'https://docs.github.com/',
          enabled: 1,
          approved: 1,
          etag: null,
          last_error: '',
          fetched_at: null,
          due_at: now,
        })
        .execute();
      await h.db
        .insertInto('interest_forecast_templates')
        .values({
          id: 'new-release',
          name: '项目新版',
          field: 'technology',
          board: 'opensource',
          source_id: 'official',
          target: 'v2.0.0',
          days_ahead: 7,
          enabled: 1,
        })
        .execute();
      await h.db
        .insertInto('interest_forecast_templates')
        .values({
          id: 'aaa-obsolete',
          name: 'Obsolete',
          field: 'technology',
          board: 'opensource',
          source_id: 'official',
          target: 'v1.0.0',
          days_ahead: 7,
          enabled: 1,
        })
        .execute();
      let released = false;
      const fetcher = async () => ({
        value: [
          {
            id: 1,
            tag_name: released ? 'v2.0.0' : 'v1.0.0',
            name: '正式版本',
            published_at: released ? '2030-02-03T00:00:00Z' : '2030-01-01T00:00:00Z',
            html_url:
              'https://github.com/example/project/releases/tag/' + (released ? 'v2.0.0' : 'v1.0.0'),
          },
        ],
        etag: null,
        notModified: false,
      });
      const service = new ForecastsService(h.db, fetcher, async () => ({
        probability: 0.65,
        reasoning: '根据给出的官方正式版本历史与当前信息作出概率判断，仍存在不确定性。',
        counterEvidence: '发布计划可能延后，历史记录无法保证未来。',
        evidenceIds: ['e0'],
      }));
      const results = await Promise.all([
        service.generate(now, { providerReady: true }),
        service.generate(now, { providerReady: true }),
      ]);
      expect(results.filter((r) => r.state === 'published')).toHaveLength(1);
      const original = await h.db
        .selectFrom('interest_forecasts')
        .selectAll()
        .executeTakeFirstOrThrow();
      released = true;
      await h.db
        .updateTable('interest_forecast_templates')
        .set({ target: 'v999.0.0' })
        .where('id', '=', 'new-release')
        .execute();
      await service.autoResolve(new Date('2030-02-10T00:00:00Z'));
      const resolved = await service.get(original.id);
      expect(resolved.outcome).toBe(1);
      expect(resolved.probability).toBe(0.65);
      expect(resolved.reasoning).toBe(original.reasoning);
      expect(resolved.resultEvidence).toHaveLength(1);
      const paused = await service.generate(new Date('2030-02-11T00:00:00Z'), {
        providerReady: false,
      });
      expect(paused.state).toBe('paused');
      expect(await h.db.selectFrom('interest_forecasts').select('id').execute()).toHaveLength(1);
      const retryAt = new Date('2030-02-12T00:00:00Z');
      await h.db
        .insertInto('interest_usage')
        .values({ business_day: '2030-02-12', count: 2 })
        .execute();
      expect((await service.generate(retryAt, { providerReady: true })).state).toBe('paused');
      const recoveryAt = new Date('2030-02-13T00:00:00Z');
      await h.db
        .insertInto('interest_forecast_days')
        .values({
          business_day: '2030-02-13',
          state: 'running',
          reason: '',
          created_at: new Date(recoveryAt.getTime() - 16 * 60000),
          updated_at: new Date(recoveryAt.getTime() - 16 * 60000),
        })
        .execute();
      expect((await service.generate(recoveryAt, { providerReady: true })).state).toBe('published');
      expect((await service.get(original.id)).reasoning).toBe(original.reasoning);
    } finally {
      await h.close();
    }
  });
  it('accepts feed metadata without expanding external entities or importing full articles', () => {
    const feed = candidates(
      'rss',
      '<rss><channel><item><title>New release</title><link>https://example.com/release</link><guid>one</guid><pubDate>Tue, 01 Jan 2030 08:00:00 GMT</pubDate><description><![CDATA[<b>Source summary</b>]]></description><content:encoded>FULL ARTICLE</content:encoded></item></channel></rss>',
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]!.summary).toBe('Source summary');
    expect(JSON.stringify(feed)).not.toContain('FULL ARTICLE');
    const atom = candidates(
      'rss',
      '<feed><entry><id>two</id><title>Atom</title><link href="https://example.com/atom"/><updated>2030-01-01T08:00:00Z</updated><summary>Summary</summary></entry></feed>',
    );
    expect(atom[0]!.url).toBe('https://example.com/atom');
    expect(() =>
      candidates('rss', '<!DOCTYPE rss [<!ENTITY ex SYSTEM "file:///etc/passwd">]><rss>&ex;</rss>'),
    ).toThrow();
  });
  it('isolates saved items, notifies followers idempotently, enforces publication restrictions and hides moderated artifacts', async () => {
    const h = await createTestApp();
    try {
      await new CommunitiesService(h.db).seedDefaults();
      const auth = new PasswordAuthService(h.db),
        a = await auth.register({ username: 'artifact_a', password: 'Interest tests 82!' }, 'a'),
        b = await auth.register({ username: 'artifact_b', password: 'Interest tests 82!' }, 'b');
      const client = request(h.app.getHttpServer()),
        now = new Date();
      await h.db
        .insertInto('interest_sources')
        .values({
          id: 'source',
          name: 'Source',
          board: 'ai',
          kind: 'github',
          url: 'https://api.github.com/repos/example/project/releases',
          terms_url: 'https://docs.github.com/',
          enabled: 1,
          approved: 1,
          etag: null,
          last_error: '',
          fetched_at: null,
          due_at: now,
        })
        .execute();
      const published = await new NewsService(h.db).publish(
        'source',
        {
          externalId: '1',
          title: 'Official update',
          url: 'https://github.com/example/project/releases/tag/v1',
          summary: '',
          publishedAt: now,
          language: '',
        },
        now,
      );
      const id = 'id' in published ? published.id : '',
        base = '/api/v1/interest/items/news/' + id;
      await client
        .post(base + '/actions')
        .auth(a.token, { type: 'bearer' })
        .send({ kind: 'follow', active: true })
        .expect(201);
      await client
        .post(base + '/actions')
        .auth(a.token, { type: 'bearer' })
        .send({ kind: 'save', active: true })
        .expect(201);
      expect(
        (
          await client
            .get('/api/v1/interest/news?saved=true')
            .auth(b.token, { type: 'bearer' })
            .expect(200)
        ).body.items,
      ).toHaveLength(0);
      const comment = { id: randomUUID(), body: 'A substantive comment' };
      await client
        .post(base + '/comments')
        .auth(b.token, { type: 'bearer' })
        .send(comment)
        .expect(201);
      await client
        .post(base + '/comments')
        .auth(b.token, { type: 'bearer' })
        .send(comment)
        .expect(201);
      expect(
        await h.db
          .selectFrom('admin_notifications')
          .select('id')
          .where('user_id', '=', a.actor.userId)
          .execute(),
      ).toHaveLength(1);
      await client
        .post(base + '/reports')
        .auth(a.token, { type: 'bearer' })
        .send({ reason: 'Report article' })
        .expect(201);
      await client
        .post(base + '/reports')
        .auth(a.token, { type: 'bearer' })
        .send({ reason: 'Report comment', commentId: comment.id })
        .expect(201);
      await client
        .post(base + '/reports')
        .auth(a.token, { type: 'bearer' })
        .send({ reason: 'Same comment duplicate', commentId: comment.id })
        .expect(201);
      expect(await h.db.selectFrom('interest_reports').select('id').execute()).toHaveLength(2);
      await h.db
        .insertInto('admin_restrictions')
        .values({
          user_id: b.actor.userId,
          until_at: new Date(Date.now() + 60000),
          reason: 'Test restriction',
        })
        .execute();
      await client
        .post(base + '/comments')
        .auth(b.token, { type: 'bearer' })
        .send({ id: randomUUID(), body: 'Blocked' })
        .expect(403);
      await client
        .post('/api/v1/interest/admin/moderate')
        .auth(a.token, { type: 'bearer' })
        .send({ targetType: 'news', targetId: id, hidden: true, reason: 'Member cannot moderate' })
        .expect(403);
      await h.db
        .insertInto('platform_roles')
        .values({ user_id: a.actor.userId, role: 'admin' })
        .execute();
      await client
        .post('/api/v1/interest/admin/moderate')
        .auth(a.token, { type: 'bearer' })
        .send({ targetType: 'news', targetId: id, hidden: true, reason: 'Hidden for review' })
        .expect(201);
      await client.get(base).expect(404);
      await client
        .post(base + '/comments')
        .auth(a.token, { type: 'bearer' })
        .send({ id: randomUUID(), body: 'Cannot reply to hidden item' })
        .expect(404);
      expect((await client.get('/api/v1/interest/news').expect(200)).body.items).toHaveLength(0);
    } finally {
      await h.close();
    }
  });
  it('blocks private destinations and canonicalizes only tracking parameters', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.2',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      '::ffff:127.0.0.1',
      '2001:db8::1',
    ])
      expect(isPublicAddress(address)).toBe(false);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(() => validateSourceUrl('https://127.0.0.1/')).toThrow();
    expect(() => validateSourceUrl('http://api.github.com/')).toThrow();
    expect(() => validateSourceUrl('https://evil.example/')).toThrow();
    expect(canonicalUrl('https://example.com/item?id=3&utm_source=a#x')).toBe(
      'https://example.com/item?id=3',
    );
  });
});
