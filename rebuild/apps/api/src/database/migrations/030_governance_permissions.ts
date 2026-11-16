import type { Kysely } from 'kysely';
import type { Database } from '../database.types.js';
import {
  moderatorGroupId,
  normalizePermissions,
} from '../../../../../packages/contracts/src/admin.js';

export async function up(db: Kysely<Database>) {
  const group = await db
    .selectFrom('moderation_groups')
    .selectAll()
    .where('id', '=', moderatorGroupId)
    .executeTakeFirst();
  if (!group) return;
  const permissions = normalizePermissions([
    ...JSON.parse(group.permissions),
    'teams.manage',
    'boards.edit',
  ]);
  await db
    .updateTable('moderation_groups')
    .set({ permissions: JSON.stringify(permissions) })
    .where('id', '=', group.id)
    .execute();
}
