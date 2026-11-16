import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import {
  KnowledgeDirectoryChangeSchema,
  KnowledgeRouteSchema,
  type KnowledgeDirectoryChange,
  type KnowledgeRouteInput,
} from '../../../../../packages/contracts/src/knowledge.js';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import {
  type KnowledgeDb,
  knowledgeWrite,
  conflict,
  validReason,
  event,
} from './knowledge-core.js';
import { KnowledgeAccess } from './knowledge-access.js';
import { KnowledgeDirectoriesService } from './knowledge-directories.service.js';
import { KnowledgeRoutesService } from './knowledge-routes.service.js';
export type OrganizationInput =
  | { kind: 'directory'; change: KnowledgeDirectoryChange }
  | { kind: 'route'; change: KnowledgeRouteInput };
export class KnowledgeOrganizationProposalsService {
  constructor(private readonly db: KnowledgeDb) {}
  async submit(ctx: RequestContext, communityId: string, input: OrganizationInput) {
    const change =
      input.kind === 'directory'
        ? KnowledgeDirectoryChangeSchema.parse(input.change)
        : KnowledgeRouteSchema.parse(input.change);
    return knowledgeWrite(this.db, async (tx) => {
      const actor = await new KnowledgeAccess(tx).member(ctx);
      await new KnowledgeDirectoriesService(tx).community(communityId);
      const id = randomUUID();
      await tx
        .insertInto('knowledge_organization_proposals')
        .values({
          id,
          community_id: communityId,
          author_id: actor.userId,
          kind: input.kind,
          payload: JSON.stringify(change),
          state: 'pending',
          reason: '',
          created_at: new Date(),
        })
        .execute();
      return { id };
    });
  }
  async list(ctx: RequestContext, communityId: string) {
    const access = new KnowledgeAccess(this.db),
      actor = await access.member(ctx);
    const cap = await access.capabilities(ctx, communityId);
    let q = this.db
      .selectFrom('knowledge_organization_proposals')
      .selectAll()
      .where('community_id', '=', communityId);
    if (!cap.canOrganizeCommunity) q = q.where('author_id', '=', actor.userId);
    return q.orderBy('created_at', 'desc').limit(100).execute();
  }
  async review(
    ctx: RequestContext,
    proposalId: string,
    decision: 'approve' | 'return',
    reason: string,
  ) {
    return knowledgeWrite(this.db, async (tx) => {
      const row = await tx
        .selectFrom('knowledge_organization_proposals')
        .selectAll()
        .where('id', '=', proposalId)
        .executeTakeFirst();
      if (!row) throw new NotFoundException('PROPOSAL_NOT_FOUND');
      await new KnowledgeAccess(tx).assertCommunityOrganizer(ctx, row.community_id);
      if (row.state !== 'pending') conflict('PROPOSAL_ALREADY_REVIEWED');
      if (decision === 'return') validReason(reason);
      else if (row.kind === 'directory')
        await new KnowledgeDirectoriesService(tx).applyIn(
          ctx,
          row.community_id,
          KnowledgeDirectoryChangeSchema.parse(JSON.parse(row.payload) as unknown),
        );
      else
        await new KnowledgeRoutesService(tx).saveIn(
          ctx,
          row.community_id,
          KnowledgeRouteSchema.parse(JSON.parse(row.payload) as unknown),
        );
      await tx
        .updateTable('knowledge_organization_proposals')
        .set({ state: decision === 'approve' ? 'approved' : 'returned', reason })
        .where('id', '=', row.id)
        .execute();
      await event(tx, ctx, null, 'organization-' + decision, reason);
    });
  }
}
