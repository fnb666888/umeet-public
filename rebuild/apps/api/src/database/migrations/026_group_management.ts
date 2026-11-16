import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types.js';
import {
  moderatorGroupId,
  moderationOperations,
} from '../../../../../packages/contracts/src/admin.js';

export async function up(db: Kysely<Database>) {
  await db.transaction().execute(async (tx) => {
    const groups = await tx.selectFrom('moderation_groups').selectAll().execute();
    const members = await tx.selectFrom('moderation_group_members').selectAll().execute();
    const roles = await tx
      .selectFrom('community_roles')
      .selectAll()
      .where('role', 'in', ['owner', 'moderator'])
      .execute();
    await tx
      .insertInto('admin_actions')
      .values({
        id: '00000000-0000-4000-8000-000000000026',
        actor_id: 'system',
        target: 'groups',
        action: 'group.reset',
        request_hash: '',
        reason: '按确认的群组需求重置旧授权',
        before_data: JSON.stringify({ groups, members, roles }),
        after_data: '{}',
        created_at: new Date(),
      })
      .execute();
    await tx.deleteFrom('moderation_group_members').execute();
    await tx.deleteFrom('moderation_groups').execute();
    await tx.deleteFrom('community_roles').where('role', 'in', ['owner', 'moderator']).execute();
    await tx
      .insertInto('moderation_groups')
      .values({
        id: moderatorGroupId,
        name: '版主',
        boards: '[]',
        permissions: JSON.stringify(moderationOperations),
      })
      .execute();
    const owner = await tx
      .selectFrom('platform_roles')
      .select('user_id')
      .where('role', '=', 'owner')
      .executeTakeFirst();
    if (!owner) {
      const admin = await tx
        .selectFrom('platform_roles as role')
        .innerJoin('users as user', 'user.id', 'role.user_id')
        .select('role.user_id')
        .where('role.role', '=', 'admin')
        .where('user.deleted_at', 'is', null)
        .orderBy('user.created_at')
        .orderBy('user.id')
        .executeTakeFirst();
      if (admin)
        await tx
          .insertInto('platform_roles')
          .values({ user_id: admin.user_id, role: 'owner' })
          .execute();
    }
    await sql`UPDATE demo_content SET version = version + 1 WHERE id = 'global'`.execute(tx);
  });
}
