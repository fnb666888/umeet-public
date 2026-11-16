import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await db.schema
    .createTable('registration_invites')
    .ifNotExists()
    .addColumn('code_hash', 'varchar(64)', (column) => column.primaryKey())
    .addColumn('expires_at', sql`datetime(3)`, (column) => column.notNull())
    .addColumn('used_at', sql`datetime(3)`)
    .execute();
  await db.schema
    .createTable('post_reviews')
    .ifNotExists()
    .addColumn('id', 'varchar(100)', (column) => column.primaryKey())
    .addColumn('board', 'varchar(24)', (column) => column.notNull())
    .addColumn('user_id', 'varchar(36)', (column) => column.notNull())
    .addColumn('status', 'varchar(16)', (column) => column.notNull())
    .addColumn('data', sql`mediumtext`, (column) => column.notNull())
    .addColumn('reason', 'varchar(500)', (column) => column.notNull())
    .addColumn('created_at', sql`datetime(3)`, (column) => column.notNull())
    .execute();
}
