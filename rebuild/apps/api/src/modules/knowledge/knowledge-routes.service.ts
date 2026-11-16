import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  KnowledgeRouteSchema,
  type KnowledgeRouteInput,
  type KnowledgeRoute,
} from '../../../../../packages/contracts/src/knowledge.js';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import { type KnowledgeDb, knowledgeWrite, conflict, event } from './knowledge-core.js';
import { KnowledgeAccess } from './knowledge-access.js';
import { KnowledgeReadService } from './knowledge-read.service.js';
export class KnowledgeRoutesService {
  constructor(private readonly db: KnowledgeDb) {}
  async list(communityId?: string) {
    let q = this.db
      .selectFrom('knowledge_routes')
      .select(['id', 'community_id as communityId', 'title', 'goal', 'version']);
    if (communityId) q = q.where('community_id', '=', communityId);
    return q.orderBy('updated_at', 'desc').limit(100).execute();
  }
  async read(routeId: string): Promise<KnowledgeRoute | null> {
    const r = await this.db
      .selectFrom('knowledge_routes')
      .selectAll()
      .where('id', '=', routeId)
      .executeTakeFirst();
    if (!r) return null;
    const steps = await this.db
      .selectFrom('knowledge_route_steps')
      .selectAll()
      .where('route_id', '=', routeId)
      .orderBy('position')
      .execute();
    const read = new KnowledgeReadService(this.db);
    return {
      id: r.id,
      communityId: r.community_id,
      title: r.title,
      goal: r.goal,
      version: r.version,
      steps: await Promise.all(
        steps.map(async (s) => {
          const p = await read.readPublished(s.page_id);
          return {
            id: s.id,
            pageId: s.page_id,
            goal: s.goal,
            intro: s.intro,
            position: s.position,
            title: p?.title ?? '词条不可用',
            revisionId: p?.revisionId ?? null,
            confirmedRevisionId: s.confirmed_revision_id,
            needsReview: !p || p.revisionId !== s.confirmed_revision_id,
            available: !!p,
          };
        }),
      ),
    };
  }
  async save(ctx: RequestContext, communityId: string, raw: KnowledgeRouteInput) {
    const input = KnowledgeRouteSchema.parse(raw);
    return knowledgeWrite(this.db, (tx) =>
      new KnowledgeRoutesService(tx).saveIn(ctx, communityId, input),
    );
  }
  async saveIn(ctx: RequestContext, communityId: string, input: KnowledgeRouteInput) {
    await new KnowledgeAccess(this.db).assertCommunityOrganizer(ctx, communityId);
    const old = input.id ? await this.read(input.id) : null;
    if (input.id && !old) throw new NotFoundException('ROUTE_NOT_FOUND');
    if (old && old.communityId !== communityId)
      throw new BadRequestException('ROUTE_COMMUNITY_MISMATCH');
    if ((old?.version ?? 0) !== input.expectedVersion) conflict('ORGANIZATION_CONFLICT');
    if (new Set(input.steps.map((s) => s.id)).size !== input.steps.length)
      throw new BadRequestException('DUPLICATE_ROUTE_STEP');
    const read = new KnowledgeReadService(this.db);
    const current = new Map<string, string>();
    for (const s of input.steps) {
      const p = await read.readPublished(s.pageId);
      if (!p) throw new BadRequestException('ROUTE_TARGET_UNAVAILABLE');
      current.set(s.pageId, p.revisionId);
    }
    const routeId = old?.id ?? randomUUID(),
      version = input.expectedVersion + 1,
      now = new Date();
    if (old)
      await this.db
        .updateTable('knowledge_routes')
        .set({ title: input.title, goal: input.goal, version, updated_at: now })
        .where('id', '=', routeId)
        .execute();
    else
      await this.db
        .insertInto('knowledge_routes')
        .values({
          id: routeId,
          community_id: communityId,
          title: input.title,
          goal: input.goal,
          version,
          updated_at: now,
        })
        .execute();
    await this.db.deleteFrom('knowledge_route_steps').where('route_id', '=', routeId).execute();
    await this.db
      .insertInto('knowledge_route_steps')
      .values(
        input.steps.map((s) => {
          const prior = old?.steps.find((p) => p.id === s.id && p.pageId === s.pageId);
          return {
            id: s.id,
            route_id: routeId,
            page_id: s.pageId,
            goal: s.goal,
            intro: s.intro,
            position: s.position,
            confirmed_revision_id: prior ? prior.confirmedRevisionId : current.get(s.pageId)!,
          };
        }),
      )
      .execute();
    await this.db
      .insertInto('knowledge_route_revisions')
      .values({
        id: randomUUID(),
        route_id: routeId,
        author_id: ctx.actor!.userId,
        payload: JSON.stringify(input),
        created_at: now,
      })
      .execute();
    await event(this.db, ctx, null, 'route', JSON.stringify({ communityId, routeId, version }));
    return { routeId, version };
  }
  async confirmStep(
    ctx: RequestContext,
    routeId: string,
    stepId: string,
    observedRevisionId: string,
  ) {
    return knowledgeWrite(this.db, async (tx) => {
      const route = await new KnowledgeRoutesService(tx).read(routeId);
      if (!route) throw new NotFoundException('ROUTE_NOT_FOUND');
      await new KnowledgeAccess(tx).assertCommunityOrganizer(ctx, route.communityId);
      const step = route.steps.find((s) => s.id === stepId);
      if (!step || !step.available || step.revisionId !== observedRevisionId)
        conflict('REVISION_CONFLICT', step?.revisionId);
      await tx
        .updateTable('knowledge_route_steps')
        .set({ confirmed_revision_id: observedRevisionId })
        .where('route_id', '=', routeId)
        .where('id', '=', stepId)
        .execute();
      await event(
        tx,
        ctx,
        step.pageId,
        'route-confirm',
        JSON.stringify({ routeId, stepId, observedRevisionId }),
      );
    });
  }
}
