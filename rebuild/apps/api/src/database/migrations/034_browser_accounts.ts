import type { Kysely } from 'kysely';
import type { Database } from '../database.types.js';
export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable('browser_login_sets')
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('secret_hash', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('current_user_id', 'varchar(64)')
    .addColumn('expires_at', 'datetime(3)', (c) => c.notNull())
    .execute();
  // No FK to sessions: a deleted backing session leaves an identifiable, expired account.
  await db.schema
    .createTable('browser_remembered_logins')
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('set_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('anchor_session_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('last_used_at', 'datetime(3)', (c) => c.notNull())
    .addUniqueConstraint('browser_saved_user', ['set_id', 'user_id'])
    .execute();
  await db.schema
    .alterTable('sessions')
    .addColumn('browser_anchor', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('browser_login_id', 'varchar(64)')
    .addColumn('browser_version', 'integer')
    .execute();
  await db.schema
    .createIndex('browser_child_session')
    .on('sessions')
    .column('browser_login_id')
    .execute();
}
