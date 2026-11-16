import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import { SourceInput, type NewsCard } from '../../../../../packages/contracts/src/interest.js';
import { requireBoards } from '../communities/board-directory.js';
import { adminActor, audit, businessDay, pageQuery, parse, type InterestDb } from './common.js';
import {
  canonicalUrl,
  fetchSource,
  plainSource,
  validateSourceUrl,
  type SourceFetcher,
} from './source-fetch.js';

import { parseFeed } from './feed.js';

export type NewsCandidate = {
  externalId: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: Date;
  language: string;
};
export function candidates(kind: string, value: unknown): NewsCandidate[] {
  if (kind === 'rss') {
    if (typeof value !== 'string') throw new Error('SOURCE_XML_INVALID');
    value = parseFeed(value);
  }
  const root = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
  const items = kind === 'github' ? value : root['items'];
  if (!Array.isArray(items)) throw new Error('SOURCE_ITEMS_INVALID');
  return items.slice(0, 50).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const v = raw as Record<string, unknown>;
    if (v['draft']) return [];
    const title = plainSource(kind === 'github' ? v['name'] || v['tag_name'] : v['title'], 300);
    const publishedAt = new Date(
      String(v[kind === 'github' ? 'published_at' : 'date_published'] || ''),
    );
    if (!title || !Number.isFinite(publishedAt.getTime()) || v['id'] === undefined) return [];
    try {
      return [
        {
          externalId: String(v['id']).slice(0, 200),
          title,
          url: canonicalUrl(String(v[kind === 'github' ? 'html_url' : 'url'] || '')),
          summary: kind === 'github' ? '' : plainSource(v['summary'], 1500),
          publishedAt,
          language: plainSource(v['language'], 40),
        },
      ];
    } catch {
      return [];
    }
  });
}
export class NewsService {
  constructor(
    readonly db: InterestDb,
    readonly fetcher: SourceFetcher = fetchSource,
  ) {}
  card(
    row: {
      id: string;
      title: string;
      url: string;
      summary: string;
      board: string;
      published_at: Date;
      language: string;
      source_id: string;
    },
    source: string,
  ): NewsCard {
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      summary: row.summary,
      board: row.board,
      source,
      publishedAt: row.published_at.toISOString(),
      language: row.language,
    };
  }
  async list(
    query: { cursor?: unknown; limit?: unknown; board?: string; saved?: string; followed?: string },
    userId: string | null = null,
  ) {
    const page = pageQuery(query.cursor, query.limit);
    let q = this.db
      .selectFrom('interest_news')
      .innerJoin('interest_sources', 'interest_sources.id', 'interest_news.source_id')
      .selectAll('interest_news')
      .select('interest_sources.name as source_name')
      .where('state', '=', 'published');
    if (query.board) q = q.where('interest_news.board', '=', query.board);
    for (const kind of ['save', 'follow'] as const)
      if ((kind === 'save' ? query.saved : query.followed) === 'true')
        q = q.where(
          'interest_news.id',
          'in',
          this.db
            .selectFrom('interest_actions')
            .select('target_id')
            .where('target_type', '=', 'news')
            .where('kind', '=', kind)
            .where('user_id', '=', userId || ''),
        );
    if (page.at)
      q = q.where((eb) =>
        eb.or([
          eb('interest_news.published_at', '<', page.at!),
          eb.and([
            eb('interest_news.published_at', '=', page.at!),
            eb('interest_news.id', '<', page.id),
          ]),
        ]),
      );
    const rows = await q
      .orderBy('interest_news.published_at', 'desc')
      .orderBy('interest_news.id', 'desc')
      .limit(page.limit + 1)
      .execute();
    const items = rows.slice(0, page.limit),
      last = items.at(-1);
    return {
      items: items.map((r) => this.card(r, r.source_name)),
      next:
        rows.length > page.limit && last ? last.published_at.toISOString() + '|' + last.id : null,
    };
  }
  async get(id: string) {
    const row = await this.db
      .selectFrom('interest_news')
      .innerJoin('interest_sources', 'interest_sources.id', 'interest_news.source_id')
      .selectAll('interest_news')
      .select('interest_sources.name as source_name')
      .where('interest_news.id', '=', id)
      .where('state', '=', 'published')
      .executeTakeFirst();
    if (!row) throw new NotFoundException('NEWS_NOT_FOUND');
    return this.card(row, row.source_name);
  }
  async saveSource(ctx: RequestContext, input: unknown) {
    const actor = await adminActor(this.db, ctx),
      data = parse(SourceInput, input);
    try {
      validateSourceUrl(data.url);
    } catch {
      throw new BadRequestException('SOURCE_HOST_NOT_ALLOWED');
    }
    if (
      data.kind === 'github' &&
      (!data.url.startsWith('https://api.github.com/repos/') ||
        !/^\/repos\/[\w.-]+\/[\w.-]+\/releases$/.test(new URL(data.url).pathname))
    )
      throw new BadRequestException('GITHUB_RELEASES_URL_REQUIRED');
    if (data.enabled && !data.approved) throw new BadRequestException('SOURCE_APPROVAL_REQUIRED');
    await requireBoards(this.db, [data.board]);
    await this.db.transaction().execute(async (tx) => {
      const row = {
        id: data.id,
        name: data.name,
        board: data.board,
        kind: data.kind,
        url: data.url,
        terms_url: data.termsUrl,
        enabled: Number(data.enabled),
        approved: Number(data.approved),
        etag: null,
        last_error: '',
        fetched_at: null,
        due_at: new Date(),
      };
      await tx
        .insertInto('interest_sources')
        .values(row)
        .onDuplicateKeyUpdate({ ...row, id: data.id })
        .execute();
      await audit(
        tx,
        actor.userId,
        'interest.source.save',
        data.id,
        '来源配置及展示范围已由管理员确认',
      );
    });
    return { ok: true };
  }
  async publish(
    sourceId: string,
    item: NewsCandidate,
    now = new Date(),
    expectedSource?: { url: string; board: string; kind: string },
  ) {
    if (item.publishedAt > now || now.getTime() - item.publishedAt.getTime() > 7 * 86400000)
      return { state: 'stale' };
    return this.db.transaction().execute(async (tx) => {
      const source = await tx
        .selectFrom('interest_sources')
        .selectAll()
        .where('id', '=', sourceId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (!source.enabled || !source.approved) return { state: 'disabled' };
      if (
        expectedSource &&
        (source.url !== expectedSource.url ||
          source.board !== expectedSource.board ||
          source.kind !== expectedSource.kind)
      )
        return { state: 'changed' };
      const url = canonicalUrl(item.url),
        dedupKey = createHash('sha256').update(url).digest('hex');
      const duplicate = await tx
        .selectFrom('interest_news')
        .select('id')
        .where((eb) =>
          eb.or([
            eb('dedup_key', '=', dedupKey),
            eb.and([eb('source_id', '=', sourceId), eb('external_id', '=', item.externalId)]),
          ]),
        )
        .executeTakeFirst();
      if (duplicate) return { state: 'duplicate', id: duplicate.id };
      const day = businessDay(now);
      await tx
        .insertInto('interest_news_quotas')
        .values({ board: source.board, business_day: day, count: 0 })
        .onDuplicateKeyUpdate({ board: source.board })
        .execute();
      const quota = await tx
        .selectFrom('interest_news_quotas')
        .select('count')
        .where('board', '=', source.board)
        .where('business_day', '=', day)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (quota.count >= 5) return { state: 'quota' };
      const id = randomUUID();
      await tx
        .insertInto('interest_news')
        .values({
          id,
          source_id: sourceId,
          external_id: item.externalId,
          dedup_key: dedupKey,
          title: item.title.slice(0, 300),
          url,
          summary: item.summary.slice(0, 1500),
          board: source.board,
          language: item.language,
          published_at: item.publishedAt,
          created_at: now,
          state: 'published',
        })
        .onDuplicateKeyUpdate({ dedup_key: dedupKey })
        .execute();
      if (
        !(await tx.selectFrom('interest_news').select('id').where('id', '=', id).executeTakeFirst())
      )
        return { state: 'duplicate' };
      await tx
        .updateTable('interest_news_quotas')
        .set({ count: sql`count + 1` })
        .where('board', '=', source.board)
        .where('business_day', '=', day)
        .execute();
      return { state: 'published', id };
    });
  }
  async collect(id: string, now = new Date()) {
    // The due-at lease prevents every API instance from fetching the same source.
    const claim = await this.db
      .updateTable('interest_sources')
      .set({ due_at: new Date(now.getTime() + 15 * 60000) })
      .where('id', '=', id)
      .where('enabled', '=', 1)
      .where('approved', '=', 1)
      .where('due_at', '<=', now)
      .executeTakeFirst();
    if (!claim.numUpdatedRows) return;
    const source = await this.db
      .selectFrom('interest_sources')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    try {
      const response = await this.fetcher(source.url, source.etag);
      if (!response.notModified) {
        const items = candidates(source.kind, response.value).sort(
          (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
        );
        for (const item of items) await this.publish(id, item, now, source);
      }
      await this.db
        .updateTable('interest_sources')
        .set({ etag: response.etag, last_error: '', fetched_at: now })
        .where('id', '=', id)
        .where('url', '=', source.url)
        .execute();
    } catch (error) {
      const reason =
        error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
          ? error.message
          : 'SOURCE_FETCH_FAILED';
      await this.db
        .updateTable('interest_sources')
        .set({ last_error: reason, due_at: new Date(now.getTime() + 30 * 60000) })
        .where('id', '=', id)
        .execute();
    }
  }
}
