import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import {
  KnowledgeDisputeDecisionSchema,
  type KnowledgeDisputeDecision,
} from '../../../../../packages/contracts/src/knowledge.js';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import { type KnowledgeDb, knowledgeWrite, pageRow, event, validReason } from './knowledge-core.js';
import { KnowledgeAccess } from './knowledge-access.js';
export class KnowledgeGovernanceService {
  constructor(private readonly db: KnowledgeDb) {}
  async raiseDispute(ctx: RequestContext, pageId: string, reason: string) {
    validReason(reason);
    return knowledgeWrite(this.db, async (tx) => {
      await new KnowledgeAccess(tx).assertGlobalWikiManager(ctx);
      await pageRow(tx, pageId);
      const id = randomUUID();
      await tx
        .insertInto('knowledge_disputes')
        .values({
          id,
          page_id: pageId,
          author_id: ctx.actor!.userId,
          reason,
          state: 'open',
          created_at: new Date(),
        })
        .execute();
      await event(tx, ctx, pageId, 'dispute-raised', reason);
      return { disputeId: id };
    });
  }
  async decideDispute(ctx: RequestContext, disputeId: string, raw: KnowledgeDisputeDecision) {
    const input = KnowledgeDisputeDecisionSchema.parse(raw);
    return knowledgeWrite(this.db, async (tx) => {
      await new KnowledgeAccess(tx).assertSiteAdmin(ctx);
      const d = await tx
        .selectFrom('knowledge_disputes')
        .selectAll()
        .where('id', '=', disputeId)
        .executeTakeFirst();
      if (!d) throw new NotFoundException('DISPUTE_NOT_FOUND');
      await pageRow(tx, d.page_id);
      await tx
        .updateTable('knowledge_pages')
        .set({ paused: input.action === 'pause' ? 1 : 0 })
        .where('id', '=', d.page_id)
        .execute();
      await tx
        .updateTable('knowledge_disputes')
        .set({
          state:
            input.action === 'resolve'
              ? 'resolved'
              : input.action === 'pause'
                ? 'reviewing'
                : 'open',
        })
        .where('id', '=', disputeId)
        .execute();
      await event(tx, ctx, d.page_id, 'dispute-' + input.action, input.reason);
    });
  }
  async setVisibility(ctx: RequestContext, pageId: string, hidden: boolean, reason: string) {
    validReason(reason);
    return knowledgeWrite(this.db, async (tx) => {
      await new KnowledgeAccess(tx).assertGlobalWikiManager(ctx);
      await pageRow(tx, pageId);
      await tx
        .updateTable('knowledge_pages')
        .set({ hidden: hidden ? 1 : 0 })
        .where('id', '=', pageId)
        .execute();
      await event(tx, ctx, pageId, hidden ? 'hide' : 'restore', reason);
    });
  }
  async purge(ctx: RequestContext, pageId: string, reason: string) {
    validReason(reason);
    return knowledgeWrite(this.db, async (tx) => {
      await new KnowledgeAccess(tx).assertSiteAdmin(ctx);
      await pageRow(tx, pageId);
      await tx
        .updateTable('knowledge_pages')
        .set({ current_revision_id: null, hidden: 1, paused: 1, purged: 1 })
        .where('id', '=', pageId)
        .execute();
      await tx
        .deleteFrom('knowledge_revision_relations')
        .where('source_page_id', '=', pageId)
        .execute();
      await tx.deleteFrom('knowledge_links').where('source_page_id', '=', pageId).execute();
      await tx.deleteFrom('knowledge_revisions').where('page_id', '=', pageId).execute();
      await tx.deleteFrom('knowledge_proposals').where('page_id', '=', pageId).execute();
      await tx.deleteFrom('knowledge_drafts').where('page_id', '=', pageId).execute();
      await tx.deleteFrom('knowledge_discussions').where('page_id', '=', pageId).execute();
      await tx.deleteFrom('knowledge_aliases').where('page_id', '=', pageId).execute();
      await tx.deleteFrom('knowledge_notification_outbox').where('page_id', '=', pageId).execute();
      await event(tx, ctx, pageId, 'purge', reason);
    });
  }
  async management(ctx: RequestContext) {
    await new KnowledgeAccess(this.db).assertGlobalWikiManager(ctx);
    const [pages, disputes, events] = await Promise.all([
      this.db
        .selectFrom('knowledge_pages as p')
        .leftJoin('knowledge_revisions as r', 'r.id', 'p.current_revision_id')
        .select(['p.id', 'p.hidden', 'p.paused', 'p.purged', 'r.title'])
        .where((eb) => eb.or([eb('p.hidden', '=', 1), eb('p.paused', '=', 1)]))
        .limit(100)
        .execute(),
      this.db
        .selectFrom('knowledge_disputes as d')
        .innerJoin('knowledge_pages as p', 'p.id', 'd.page_id')
        .selectAll('d')
        .where('p.purged', '=', 0)
        .orderBy('d.created_at', 'desc')
        .limit(100)
        .execute(),
      this.db
        .selectFrom('knowledge_events as e')
        .innerJoin('users as u', 'u.id', 'e.actor_id')
        .selectAll('e')
        .select('u.nickname as actorAlias')
        .orderBy('e.created_at', 'desc')
        .limit(100)
        .execute(),
    ]);
    return { pages, disputes, events };
  }
}
