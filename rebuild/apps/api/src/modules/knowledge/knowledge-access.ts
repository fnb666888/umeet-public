import { ForbiddenException } from '@nestjs/common';
import type { KnowledgeDb } from './knowledge-core.js';
import type {
  RequestContext,
  KnowledgeCapabilities,
} from '../../../../../packages/contracts/src/index.js';
import { requireMember } from '../identity/permissions.service.js';
import { moderationAccess } from '../admin/scope.js';
import { permits } from '../../../../../packages/contracts/src/admin.js';
import { boardSlug } from '../../../../../packages/contracts/src/boards.js';
import { requireUnrestricted } from '../admin/restrictions.js';
export class KnowledgeAccess {
  constructor(private readonly db: KnowledgeDb) {}
  async member(ctx: RequestContext) {
    const actor = requireMember(ctx);
    const user = await this.db
      .selectFrom('users')
      .select(['kind', 'deleted_at'])
      .where('id', '=', actor.userId)
      .executeTakeFirst();
    if (!user || user.deleted_at || user.kind !== 'member')
      throw new ForbiddenException('ACCOUNT_UNAVAILABLE');
    await requireUnrestricted(this.db, actor.userId, [], 'wiki');
    return actor;
  }
  async capabilities(ctx: RequestContext, communityId?: string): Promise<KnowledgeCapabilities> {
    const none: KnowledgeCapabilities = {
      accountId: ctx.actor?.userId ?? null,
      canContribute: false,
      canGovernBody: false,
      canOrganizeCommunity: false,
      isSiteAdmin: false,
    };
    if (!ctx.actor || ctx.actor.kind !== 'member') return none;
    try {
      await this.member(ctx);
    } catch (error) {
      if (error instanceof ForbiddenException) return none;
      throw error;
    }
    const access = await moderationAccess(this.db, ctx.actor.userId);
    const boards: string[] = [];
    for (const b of access.boards) {
      if (!access.admin && !permits(b.permissions, 'wiki.edit')) continue;
      try {
        await requireUnrestricted(this.db, ctx.actor.userId, [b.board], 'wiki');
        boards.push(b.board);
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    const community = communityId
      ? await this.db
          .selectFrom('communities')
          .select('slug')
          .where('id', '=', communityId)
          .executeTakeFirst()
      : null;
    return {
      ...none,
      canContribute: true,
      isSiteAdmin: access.admin,
      canGovernBody: access.admin || boards.length > 0,
      canOrganizeCommunity: communityId
        ? !!community && (access.admin || boards.includes(boardSlug(community.slug)))
        : access.admin,
    };
  }
  async assertGlobalWikiManager(ctx: RequestContext) {
    await this.member(ctx);
    if (!(await this.capabilities(ctx)).canGovernBody)
      throw new ForbiddenException('WIKI_MANAGEMENT_REQUIRED');
  }
  async assertCommunityOrganizer(ctx: RequestContext, communityId: string) {
    await this.member(ctx);
    if (!(await this.capabilities(ctx, communityId)).canOrganizeCommunity)
      throw new ForbiddenException('COMMUNITY_WIKI_MANAGEMENT_REQUIRED');
  }
  async assertSiteAdmin(ctx: RequestContext) {
    await this.member(ctx);
    if (!(await this.capabilities(ctx)).isSiteAdmin)
      throw new ForbiddenException('SITE_ADMIN_REQUIRED');
  }
}
