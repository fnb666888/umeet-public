import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types.js';
import { moderatorGroupId } from '../../../../../packages/contracts/src/admin.js';

export async function up(db: Kysely<Database>) {
  await db.schema.alterTable('moderation_group_members').addColumn('boards', 'text').execute();
  await sql`UPDATE moderation_group_members AS member
    JOIN moderation_groups AS grp ON grp.id = member.group_id
    SET member.boards = grp.boards WHERE grp.id = ${moderatorGroupId}`.execute(db);
}
