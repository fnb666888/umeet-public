import { randomUUID, createHash } from 'node:crypto';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  KnowledgeRevisionSchema,
  KnowledgeContentSchema,
  type KnowledgeRevisionInput,
  type KnowledgeProposal,
} from '../../../../../packages/contracts/src/knowledge.js';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import {
  type KnowledgeDb,
  knowledgeWrite,
  pageRow,
  event,
  conflict,
  aliasName,
  validReason,
} from './knowledge-core.js';
import { KnowledgeAccess } from './knowledge-access.js';
import { KnowledgeReadService } from './knowledge-read.service.js';
import { KnowledgeRelationsService } from './knowledge-relations.service.js';
import { KnowledgeLinksService } from './knowledge-links.service.js';
export type ReviewInput = {
  decision: 'approve' | 'return';
  reason: string;
  expectedPublishedRevisionId: string | null;
  idempotencyKey: string;
};
export class KnowledgePublishService {
  constructor(private readonly db: KnowledgeDb) {}
  async create(ctx: RequestContext) {
    return knowledgeWrite(this.db, async (tx) => {
      const actor = await new KnowledgeAccess(tx).member(ctx);
      const id = randomUUID();
      await tx
        .insertInto('knowledge_pages')
        .values({ id, current_revision_id: null, creator_id: actor.userId, created_at: new Date() })
        .execute();
      return { id };
    });
  }
  async publish(ctx: RequestContext, pageId: string, raw: KnowledgeRevisionInput) {
    const input = KnowledgeRevisionSchema.parse(raw);
    return knowledgeWrite(this.db, (tx) =>
      new KnowledgePublishService(tx).publishIn(ctx, pageId, input),
    );
  }
  async publishIn(
    ctx: RequestContext,
    pageId: string,
    input: KnowledgeRevisionInput,
    reviewOverride = false,
    contributorId = ctx.actor!.userId,
  ) {
    const access = new KnowledgeAccess(this.db);
    await access.assertGlobalWikiManager(ctx);
    const p = await pageRow(this.db, pageId);
    if (p.hidden) throw new ForbiddenException('KNOWLEDGE_HIDDEN');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const old = await this.db
      .selectFrom('knowledge_revisions')
      .selectAll()
      .where('page_id', '=', pageId)
      .where('author_id', '=', ctx.actor!.userId)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();
    if (old) {
      if (old.request_hash !== hash) conflict('IDEMPOTENCY_CONFLICT');
      const page = await new KnowledgeReadService(this.db).readPublished(pageId);
      if (!page) throw new NotFoundException('KNOWLEDGE_UNAVAILABLE');
      const author = await this.db
        .selectFrom('users')
        .select('nickname')
        .where('id', '=', old.author_id)
        .executeTakeFirstOrThrow();
      return {
        ...page,
        ...KnowledgeContentSchema.parse({
          title: old.title,
          summary: old.summary,
          markdown: old.markdown,
          template: old.template,
          relations: JSON.parse(old.relations) as unknown,
          baseRevisionId: old.base_revision_id,
          changeNote: old.change_note,
        }),
        revisionId: old.id,
        authorId: old.author_id,
        authorAlias: author.nickname,
        createdAt: old.created_at.toISOString(),
      };
    }
    if (p.paused && (!reviewOverride || !(await access.capabilities(ctx)).isSiteAdmin))
      throw new ForbiddenException('PUBLICATION_PAUSED');
    if (p.current_revision_id !== input.baseRevisionId)
      conflict('REVISION_CONFLICT', p.current_revision_id);
    await new KnowledgeRelationsService(this.db).validate(pageId, input.relations);
    const id = randomUUID(),
      now = new Date();
    await this.db
      .insertInto('knowledge_revisions')
      .values({
        id,
        page_id: pageId,
        author_id: contributorId,
        title: input.title,
        summary: input.summary,
        markdown: input.markdown,
        template: input.template,
        relations: JSON.stringify(input.relations),
        change_note: input.changeNote,
        base_revision_id: input.baseRevisionId,
        idempotency_key: input.idempotencyKey,
        request_hash: hash,
        created_at: now,
      })
      .execute();
    if (input.relations.length)
      await this.db
        .insertInto('knowledge_revision_relations')
        .values(
          input.relations.map((r) => ({
            revision_id: id,
            source_page_id: pageId,
            target_page_id: r.targetPageId,
            kind: r.type,
            conditions: r.conditions ?? '',
            explanation: r.explanation ?? '',
            evidence: r.evidence ?? '',
          })),
        )
        .execute();
    await new KnowledgeLinksService(this.db).index(id, pageId, input.markdown);
    await this.db
      .insertInto('knowledge_aliases')
      .values({ page_id: pageId, name: aliasName(input.title) })
      .ignore()
      .execute();
    await this.db
      .updateTable('knowledge_pages')
      .set({ current_revision_id: id })
      .where('id', '=', pageId)
      .execute();
    const routes = await this.db
      .selectFrom('knowledge_route_steps')
      .select('route_id')
      .where('page_id', '=', pageId)
      .distinct()
      .execute();
    for (const r of routes)
      await this.db
        .insertInto('knowledge_notification_outbox')
        .values({
          id: randomUUID(),
          route_id: r.route_id,
          page_id: pageId,
          revision_id: id,
          created_at: now,
        })
        .ignore()
        .execute();
    await event(
      this.db,
      ctx,
      pageId,
      reviewOverride ? 'review-publish' : 'publish',
      input.changeNote,
    );
    return (await new KnowledgeReadService(this.db).readPublished(pageId))!;
  }
  async submit(ctx: RequestContext, pageId: string, raw: KnowledgeRevisionInput) {
    const input = KnowledgeRevisionSchema.parse(raw);
    return knowledgeWrite(this.db, async (tx) => {
      const access = new KnowledgeAccess(tx),
        actor = await access.member(ctx),
        p = await pageRow(tx, pageId);
      if (p.hidden) throw new ForbiddenException('KNOWLEDGE_HIDDEN');
      if (
        !p.current_revision_id &&
        p.creator_id !== actor.userId &&
        !(await access.capabilities(ctx)).canGovernBody
      )
        throw new NotFoundException('KNOWLEDGE_UNAVAILABLE');
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const previous = await tx
        .selectFrom('knowledge_proposals')
        .selectAll()
        .where('page_id', '=', pageId)
        .where('author_id', '=', actor.userId)
        .where('idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst();
      if (previous) {
        if (previous.request_hash !== hash) conflict('IDEMPOTENCY_CONFLICT');
        return proposalDto(previous);
      }
      if (p.current_revision_id !== input.baseRevisionId)
        conflict('REVISION_CONFLICT', p.current_revision_id);
      await new KnowledgeRelationsService(tx).validate(pageId, input.relations);
      const row = {
        id: randomUUID(),
        page_id: pageId,
        author_id: actor.userId,
        state: 'pending',
        reason: '',
        payload: JSON.stringify(input),
        idempotency_key: input.idempotencyKey,
        request_hash: hash,
        version: 1,
        created_at: new Date(),
      };
      await tx.insertInto('knowledge_proposals').values(row).execute();
      await tx
        .deleteFrom('knowledge_drafts')
        .where('owner_id', '=', actor.userId)
        .where('page_id', '=', pageId)
        .execute();
      await event(tx, ctx, pageId, 'submit', input.changeNote);
      return proposalDto(row);
    });
  }
  async proposals(
    ctx: RequestContext,
    query: { state?: string; cursor?: string; limit?: number; id?: string } = {},
  ) {
    const access = new KnowledgeAccess(this.db),
      actor = await access.member(ctx);
    let q = this.db
      .selectFrom('knowledge_proposals as c')
      .innerJoin('knowledge_pages as p', 'p.id', 'c.page_id')
      .selectAll('c')
      .where('p.purged', '=', 0);
    if (!(await access.capabilities(ctx)).canGovernBody)
      q = q.where('c.author_id', '=', actor.userId).where('p.hidden', '=', 0);
    if (query.state && query.state !== 'all') q = q.where('c.state', '=', query.state);
    if (query.id) q = q.where('c.id', '=', query.id);
    if (query.cursor) {
      const previous = await q.where('c.id', '=', query.cursor).executeTakeFirst();
      if (!previous) return [];
      q = q.where((eb) =>
        eb.or([
          eb('c.created_at', '<', previous.created_at),
          eb.and([eb('c.created_at', '=', previous.created_at), eb('c.id', '<', previous.id)]),
        ]),
      );
    }
    return (
      await q
        .orderBy('c.created_at', 'desc')
        .orderBy('c.id', 'desc')
        .limit(query.limit ?? 200)
        .execute()
    ).map(proposalDto);
  }
  async proposal(ctx: RequestContext, id: string) {
    const rows = await this.proposals(ctx, { id, limit: 1 });
    if (!rows[0]) throw new NotFoundException('PROPOSAL_NOT_FOUND');
    return rows[0];
  }
  async review(ctx: RequestContext, proposalId: string, input: ReviewInput) {
    return knowledgeWrite(this.db, async (tx) => {
      await new KnowledgeAccess(tx).assertGlobalWikiManager(ctx);
      const row = await tx
        .selectFrom('knowledge_proposals')
        .selectAll()
        .where('id', '=', proposalId)
        .executeTakeFirst();
      if (!row) throw new NotFoundException('PROPOSAL_NOT_FOUND');
      if (row.state === 'approved' && input.decision === 'approve') return proposalDto(row);
      if (row.state !== 'pending') conflict('PROPOSAL_ALREADY_REVIEWED');
      const p = await pageRow(tx, row.page_id);
      if (p.hidden) throw new ForbiddenException('KNOWLEDGE_HIDDEN');
      if (input.decision === 'return') {
        validReason(input.reason);
        await tx
          .updateTable('knowledge_proposals')
          .set({ state: 'returned', reason: input.reason, version: row.version + 1 })
          .where('id', '=', row.id)
          .execute();
        await event(tx, ctx, row.page_id, 'return', input.reason);
        return proposalDto({
          ...row,
          state: 'returned',
          reason: input.reason,
          version: row.version + 1,
        });
      }
      if (p.current_revision_id !== input.expectedPublishedRevisionId)
        conflict('REVISION_CONFLICT', p.current_revision_id);
      const candidate = KnowledgeRevisionSchema.parse(JSON.parse(row.payload) as unknown);
      if (candidate.baseRevisionId !== p.current_revision_id)
        conflict('REVISION_CONFLICT', p.current_revision_id);
      const override = !!p.paused && (await new KnowledgeAccess(tx).capabilities(ctx)).isSiteAdmin;
      if (override) {
        validReason(input.reason);
        await event(tx, ctx, row.page_id, 'dispute-review', input.reason);
      }
      await new KnowledgePublishService(tx).publishIn(
        ctx,
        row.page_id,
        { ...candidate, idempotencyKey: 'proposal-' + row.id },
        override,
        row.author_id,
      );
      await tx
        .updateTable('knowledge_proposals')
        .set({ state: 'approved', reason: input.reason, version: row.version + 1 })
        .where('id', '=', row.id)
        .execute();
      await event(tx, ctx, row.page_id, 'approve', input.reason);
      return proposalDto({
        ...row,
        state: 'approved',
        reason: input.reason,
        version: row.version + 1,
      });
    });
  }
  async rollback(
    ctx: RequestContext,
    pageId: string,
    revisionId: string,
    baseRevisionId: string,
    idempotencyKey: string,
  ) {
    const rev = await new KnowledgeReadService(this.db).revision(pageId, revisionId);
    if (!rev) throw new NotFoundException('REVISION_NOT_FOUND');
    return this.publish(ctx, pageId, {
      ...KnowledgeContentSchema.parse({
        title: rev.title,
        summary: rev.summary,
        markdown: rev.markdown,
        template: rev.template,
        relations: rev.relations,
        baseRevisionId,
        changeNote: '回退至修订 ' + revisionId,
      }),
      idempotencyKey,
    });
  }
  async reviewPublish(
    ctx: RequestContext,
    pageId: string,
    raw: KnowledgeRevisionInput,
    reason: string,
  ) {
    validReason(reason);
    const input = KnowledgeRevisionSchema.parse(raw);
    return knowledgeWrite(this.db, async (tx) => {
      await new KnowledgeAccess(tx).assertSiteAdmin(ctx);
      await event(tx, ctx, pageId, 'dispute-review', reason);
      return new KnowledgePublishService(tx).publishIn(ctx, pageId, input, true);
    });
  }
}
function proposalDto(row: {
  id: string;
  page_id: string;
  author_id: string;
  state: string;
  reason: string;
  payload: string;
  version: number;
  created_at: Date;
}): KnowledgeProposal {
  return {
    id: row.id,
    pageId: row.page_id,
    authorId: row.author_id,
    state: row.state as KnowledgeProposal['state'],
    reason: row.reason,
    content: KnowledgeRevisionSchema.parse(JSON.parse(row.payload) as unknown),
    version: row.version,
    createdAt: row.created_at.toISOString(),
  };
}
