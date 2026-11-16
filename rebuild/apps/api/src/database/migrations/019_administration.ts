import { sql, type Kysely } from 'kysely';

export async function up<DB>(db: Kysely<DB>) {
  await db.schema
    .createTable('admin_visibility')
    .ifNotExists()
    .addColumn('target', 'varchar(150)', (c) => c.primaryKey())
    .addColumn('hidden', 'integer', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('admin_restrictions')
    .ifNotExists()
    .addColumn('user_id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('until_at', sql`datetime(3)`, (c) => c.notNull())
    .addColumn('reason', 'varchar(500)', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('admin_report_results')
    .ifNotExists()
    .addColumn('report_id', 'varchar(150)', (c) => c.primaryKey())
    .addColumn('outcome', 'varchar(16)', (c) => c.notNull())
    .addColumn('reason', 'varchar(500)', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('admin_actions')
    .ifNotExists()
    .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('actor_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('request_hash', 'varchar(64)', (c) => c.notNull())
    .addColumn('action', 'varchar(32)', (c) => c.notNull())
    .addColumn('target', 'varchar(150)', (c) => c.notNull())
    .addColumn('reason', 'varchar(500)', (c) => c.notNull())
    .addColumn('before_data', sql`longtext`, (c) => c.notNull())
    .addColumn('after_data', sql`longtext`, (c) => c.notNull())
    .addColumn('created_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('admin_notifications')
    .ifNotExists()
    .addColumn('id', 'varchar(100)', (c) => c.primaryKey())
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('text', 'varchar(200)', (c) => c.notNull())
    .addColumn('detail', 'varchar(1000)', (c) => c.notNull())
    .addColumn('href', 'varchar(200)', (c) => c.notNull())
    .addColumn('created_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
}
