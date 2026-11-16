import { createHash } from 'node:crypto';
import type { KnowledgeDb } from './knowledge-core.js';
import { knowledgeWrite } from './knowledge-core.js';
import { KnowledgeAccess } from './knowledge-access.js';
export class KnowledgeNotificationsService {
  constructor(private readonly db: KnowledgeDb) {}
  async deliverPending() {
    return knowledgeWrite(this.db, async (tx) => {
      const rows = await tx
        .selectFrom('knowledge_notification_outbox')
        .selectAll()
        .where('delivered', '=', 0)
        .orderBy('created_at')
        .limit(100)
        .execute();
      let delivered = 0;
      const members = await tx.selectFrom('moderation_group_members').select('user_id').execute(),
        admins = await tx.selectFrom('platform_roles').select('user_id').execute(),
        assistants = await tx
          .selectFrom('community_team_members')
          .select('user_id')
          .where('state', 'in', ['active', 'exit_requested'])
          .execute();
      const candidates = [...new Set([...members, ...admins, ...assistants].map((r) => r.user_id))];
      for (const row of rows) {
        const route = await tx
          .selectFrom('knowledge_routes')
          .select(['community_id', 'title'])
          .where('id', '=', row.route_id)
          .executeTakeFirst();
        const page = await tx
          .selectFrom('knowledge_pages')
          .select(['current_revision_id', 'hidden', 'purged'])
          .where('id', '=', row.page_id)
          .executeTakeFirst();
        const pendingStep = await tx
          .selectFrom('knowledge_route_steps')
          .select('id')
          .where('route_id', '=', row.route_id)
          .where('page_id', '=', row.page_id)
          .where((eb) =>
            eb.or([
              eb('confirmed_revision_id', 'is', null),
              eb('confirmed_revision_id', '!=', row.revision_id),
            ]),
          )
          .executeTakeFirst();
        // Ignore superseded updates and steps already reviewed before the worker ran.
        if (
          route &&
          page?.current_revision_id === row.revision_id &&
          !page.hidden &&
          !page.purged &&
          pendingStep
        )
          for (const userId of candidates) {
            const cap = await new KnowledgeAccess(tx).capabilities(
              {
                actor: { userId, kind: 'member', platformRoles: [] },
                requestId: 'knowledge-notification',
              },
              route.community_id,
            );
            if (!cap.canOrganizeCommunity) continue;
            const id = createHash('sha256')
              .update(row.id + ':' + userId)
              .digest('hex');
            await tx
              .insertInto('admin_notifications')
              .values({
                id,
                user_id: userId,
                text: '学习路线中的词条已有更新',
                detail: route.title + '：请复核步骤导读与前置知识。',
                href: '/knowledge/routes/' + row.route_id,
                created_at: new Date(),
              })
              .ignore()
              .execute();
          }
        await tx
          .updateTable('knowledge_notification_outbox')
          .set({ delivered: 1 })
          .where('id', '=', row.id)
          .execute();
        delivered++;
      }
      return { delivered };
    });
  }
}
