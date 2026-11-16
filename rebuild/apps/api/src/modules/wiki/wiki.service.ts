import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type {
  RequestContext,
  SaveRevisionInput,
  WikiRevisionDto,
  WikiPageMetadata,
} from '../../../../../packages/contracts/src/index.js';
import { SaveRevisionSchema } from '../../../../../packages/contracts/src/index.js';
import { randomUUID, createHash } from 'node:crypto';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { requireMember } from '../identity/permissions.service.js';
import { boardCommunities, hasModerationPermission, moderationAccess } from '../admin/scope.js';
import { JobsService } from '../jobs/jobs.service.js';
import { parseMarkdown } from '../../../../../packages/markdown/src/parse.js';
import { validateDocument } from '../../../../../packages/markdown/src/schema.js';
import { WikiLinksService } from './wiki-links.service.js';
import { requireCommunityUnrestricted, requireUnrestricted } from '../admin/restrictions.js';
type RevisionRow = {
  id: string;
  page_id: string;
  title: string;
  markdown: string;
  change_note: string;
  previous_revision_id: string | null;
  created_at: Date;
  nickname: string;
};
function dto(row: RevisionRow): WikiRevisionDto {
  return {
    id: row.id,
    pageId: row.page_id,
    title: row.title,
    markdown: row.markdown,
    changeNote: row.change_note,
    previousRevisionId: row.previous_revision_id,
    createdAt: row.created_at.toISOString(),
    authorAlias: row.nickname,
  };
}
export class WikiService {
  constructor(private readonly db: Kysely<Database>) {}
  async createPage(ctx: RequestContext, community: string, slug: string): Promise<{ id: string }> {
    await requireCommunityUnrestricted(this.db, requireMember(ctx).userId, community, 'wiki');
    return this.db.transaction().execute((tx) => this.createInTransaction(tx, community, slug));
  }
  private async createInTransaction(
    tx: Transaction<Database>,
    community: string,
    rawSlug: string,
  ): Promise<{ id: string }> {
    const parsed = z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[\p{L}\p{N}_-]+$/u)
      .safeParse(rawSlug.normalize('NFKC').toLowerCase());
    if (!parsed.success) throw new BadRequestException('INVALID_WIKI_SLUG');
    if (
      !(await tx
        .selectFrom('communities')
        .select('id')
        .where('id', '=', community)
        .executeTakeFirst())
    )
      throw new NotFoundException('COMMUNITY_NOT_FOUND');
    const id = randomUUID();
    try {
      await tx
        .insertInto('wiki_pages')
        .values({ id, community_id: community, slug: parsed.data, current_revision_id: null })
        .execute();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY')
        throw new ConflictException('WIKI_SLUG_UNAVAILABLE');
      throw error;
    }
    return { id };
  }
  async publishNew(
    ctx: RequestContext,
    community: string,
    slug: string,
    input: SaveRevisionInput,
  ): Promise<WikiRevisionDto> {
    const actor = requireMember(ctx);
    await requireCommunityUnrestricted(this.db, actor.userId, community, 'wiki');
    if (input.baseRevisionId !== null)
      throw new BadRequestException('INITIAL_REVISION_BASE_MUST_BE_NULL');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.transaction().execute(async (tx) => {
          const existing = await tx
            .selectFrom('wiki_pages')
            .select('id')
            .where('community_id', '=', community)
            .where('slug', '=', slug.normalize('NFKC').trim().toLowerCase())
            .forUpdate()
            .executeTakeFirst();
          if (existing) {
            const committed = await tx
              .selectFrom('wiki_revisions')
              .select('id')
              .where('page_id', '=', existing.id)
              .where('author_id', '=', actor.userId)
              .where('idempotency_key', '=', input.idempotencyKey)
              .executeTakeFirst();
            if (!committed) throw new ConflictException('WIKI_SLUG_UNAVAILABLE');
            return this.saveInTransaction(tx, ctx, existing.id, input);
          }
          const page = await this.createInTransaction(tx, community, slug);
          return this.saveInTransaction(tx, ctx, page.id, input);
        });
      } catch (error) {
        const deadlock =
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ER_LOCK_DEADLOCK';
        if (!deadlock || attempt === 2) throw error;
      }
    }
    throw new Error('WIKI_PUBLICATION_RETRY_EXHAUSTED');
  }
  async saveRevision(
    ctx: RequestContext,
    pageId: string,
    raw: SaveRevisionInput,
  ): Promise<WikiRevisionDto> {
    return this.db.transaction().execute((tx) => this.saveInTransaction(tx, ctx, pageId, raw));
  }
  private async saveInTransaction(
    tx: Transaction<Database>,
    ctx: RequestContext,
    pageId: string,
    raw: SaveRevisionInput,
  ): Promise<WikiRevisionDto> {
    const actor = requireMember(ctx),
      input = SaveRevisionSchema.parse(raw);
    await requireUnrestricted(tx, actor.userId, [], 'wiki');
    const ast = parseMarkdown(input.markdown),
      validation = validateDocument(ast);
    if (!validation.valid)
      throw new BadRequestException({
        code: 'UNSAFE_MARKDOWN',
        message: 'UNSAFE_MARKDOWN',
        issues: validation.issues,
      });
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const page = await tx
      .selectFrom('wiki_pages')
      .selectAll()
      .where('id', '=', pageId)
      .forUpdate()
      .executeTakeFirst();
    if (!page) throw new NotFoundException('WIKI_PAGE_NOT_FOUND');
    await requireCommunityUnrestricted(tx, actor.userId, page.community_id, 'wiki');
    if (page.protected) {
      const community = await tx
        .selectFrom('communities')
        .select('slug')
        .where('id', '=', page.community_id)
        .executeTakeFirstOrThrow();
      const board = Object.keys(boardCommunities).find(
        (entry) => boardCommunities[entry] === community.slug,
      );
      const access = await moderationAccess(tx, actor.userId);
      if (!access.admin && (!board || !hasModerationPermission(access, board, 'wiki.edit')))
        throw new ForbiddenException('WIKI_PROTECTED');
    }
    const existing = await tx
      .selectFrom('wiki_revisions')
      .selectAll()
      .where('page_id', '=', pageId)
      .where('author_id', '=', actor.userId)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();
    const author = await tx
      .selectFrom('users')
      .select('nickname')
      .where('id', '=', actor.userId)
      .executeTakeFirstOrThrow();
    if (existing) {
      if (existing.request_hash !== hash) throw new ConflictException('IDEMPOTENCY_CONFLICT');
      if (existing.visibility !== 'public') throw new ConflictException('REVISION_NOT_PUBLIC');
      return dto({ ...existing, nickname: author.nickname });
    }
    if (page.current_revision_id !== input.baseRevisionId)
      throw new ConflictException({
        code: 'WIKI_REVISION_CONFLICT',
        message: '词条已有更新，请合并后保存。',
        latestRevisionId: page.current_revision_id,
      });
    const id = randomUUID(),
      createdAt = new Date();
    await tx
      .insertInto('wiki_revisions')
      .values({
        id,
        page_id: pageId,
        author_id: actor.userId,
        title: input.title,
        markdown: input.markdown,
        change_note: input.changeNote,
        previous_revision_id: page.current_revision_id,
        idempotency_key: input.idempotencyKey,
        request_hash: hash,
        created_at: createdAt,
      })
      .execute();
    await tx
      .updateTable('wiki_pages')
      .set({ current_revision_id: id })
      .where('id', '=', pageId)
      .execute();
    const community = await tx
      .selectFrom('communities')
      .select('slug')
      .where('id', '=', page.community_id)
      .executeTakeFirstOrThrow();
    await new WikiLinksService(this.db).record(tx, id, pageId, community.slug, ast);
    await new JobsService(this.db).enqueue(
      tx,
      { kind: 'wiki.updated', key: 'wiki.updated:' + id, payload: { pageId, revisionId: id } },
      createdAt,
    );
    return {
      id,
      pageId,
      title: input.title,
      markdown: input.markdown,
      changeNote: input.changeNote,
      authorAlias: author.nickname,
      createdAt: createdAt.toISOString(),
      previousRevisionId: page.current_revision_id,
    };
  }
  async rollback(
    ctx: RequestContext,
    id: string,
    input: { targetRevisionId: string; baseRevisionId: string; idempotencyKey: string },
  ): Promise<WikiRevisionDto> {
    requireMember(ctx);
    const target = await this.db
      .selectFrom('wiki_revisions')
      .selectAll()
      .where('page_id', '=', id)
      .where('id', '=', input.targetRevisionId)
      .where('visibility', '=', 'public')
      .executeTakeFirst();
    if (!target) throw new NotFoundException('WIKI_REVISION_NOT_FOUND');
    return this.saveRevision(ctx, id, {
      title: target.title,
      markdown: target.markdown,
      baseRevisionId: input.baseRevisionId,
      changeNote: '回滚至《' + target.title + '》（' + target.created_at.toISOString() + '）',
      idempotencyKey: input.idempotencyKey,
    });
  }
  async read(id: string): Promise<WikiRevisionDto | null> {
    const row = await this.db
      .selectFrom('wiki_pages')
      .innerJoin('wiki_revisions', 'wiki_revisions.id', 'wiki_pages.current_revision_id')
      .innerJoin('users', 'users.id', 'wiki_revisions.author_id')
      .select([
        'wiki_revisions.id',
        'page_id',
        'title',
        'markdown',
        'change_note',
        'previous_revision_id',
        'wiki_revisions.created_at',
        'users.nickname',
      ])
      .where('wiki_pages.id', '=', id)
      .where('visibility', '=', 'public')
      .executeTakeFirst();
    return row ? dto(row) : null;
  }
  async metadata(id: string): Promise<WikiPageMetadata> {
    const row = await this.db
      .selectFrom('wiki_pages')
      .innerJoin('communities', 'communities.id', 'wiki_pages.community_id')
      .innerJoin('wiki_revisions', 'wiki_revisions.id', 'wiki_pages.current_revision_id')
      .select([
        'wiki_pages.id',
        'wiki_pages.slug',
        'wiki_pages.community_id',
        'wiki_pages.protected',
        'communities.slug as community_slug',
        'communities.name as community_name',
      ])
      .where('wiki_pages.id', '=', id)
      .where('wiki_revisions.visibility', '=', 'public')
      .executeTakeFirst();
    if (!row) throw new NotFoundException('WIKI_PAGE_NOT_FOUND');
    return {
      id: row.id,
      slug: row.slug,
      communityId: row.community_id,
      communitySlug: row.community_slug,
      communityName: row.community_name,
      protected: !!row.protected,
    };
  }
  async resolve(communitySlug: string, slug: string): Promise<{ id: string }> {
    const row = await this.db
      .selectFrom('wiki_pages')
      .innerJoin('communities', 'communities.id', 'wiki_pages.community_id')
      .innerJoin('wiki_revisions', 'wiki_revisions.id', 'wiki_pages.current_revision_id')
      .select('wiki_pages.id')
      .where('communities.slug', '=', communitySlug)
      .where('wiki_pages.slug', '=', slug.normalize('NFKC').toLowerCase())
      .where('wiki_revisions.visibility', '=', 'public')
      .executeTakeFirst();
    if (!row) throw new NotFoundException('WIKI_PAGE_NOT_FOUND');
    return row;
  }
  async history(id: string): Promise<WikiRevisionDto[]> {
    const rows = await this.db
      .selectFrom('wiki_revisions')
      .innerJoin('users', 'users.id', 'wiki_revisions.author_id')
      .select([
        'wiki_revisions.id',
        'page_id',
        'title',
        'markdown',
        'change_note',
        'previous_revision_id',
        'wiki_revisions.created_at',
        'users.nickname',
      ])
      .where('page_id', '=', id)
      .where('visibility', '=', 'public')
      .orderBy('wiki_revisions.created_at', 'desc')
      .orderBy('wiki_revisions.id', 'desc')
      .execute();
    return rows.map(dto);
  }
}
