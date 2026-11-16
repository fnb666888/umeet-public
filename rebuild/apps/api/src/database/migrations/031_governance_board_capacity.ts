import type { Kysely } from 'kysely';
import type { Database } from '../database.types.js';

export async function up(db: Kysely<Database>) {
  await db.schema
    .alterTable('community_restrictions')
    .modifyColumn('board', 'varchar(80)', (column) => column.notNull())
    .execute();
  await db.schema.alterTable('admin_actions').modifyColumn('board', 'varchar(80)').execute();
  await db.schema.alterTable('moderation_penalties').modifyColumn('board', 'varchar(80)').execute();
  await db.schema
    .alterTable('moderation_action_effects')
    .modifyColumn('board', 'varchar(80)')
    .execute();
  await db.schema
    .alterTable('post_reviews')
    .modifyColumn('board', 'varchar(80)', (column) => column.notNull())
    .execute();
}
