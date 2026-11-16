import { sql, type Kysely } from 'kysely';

export async function up<DB>(db: Kysely<DB>) {
  await db.schema
    .createTable('moderation_penalties')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('board', 'varchar(32)')
    .addColumn('capability', 'varchar(32)', (c) => c.notNull())
    .addColumn('reason', 'varchar(500)', (c) => c.notNull())
    .addColumn('until_at', sql.raw('datetime(3)'))
    .addColumn('revoked_at', sql.raw('datetime(3)'))
    .addColumn('created_at', sql.raw('datetime(3)'), (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('moderation_appeals')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('action_id', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('reason', 'varchar(1000)', (c) => c.notNull())
    .addColumn('status', 'varchar(32)', (c) => c.notNull())
    .addColumn('resolution', 'varchar(500)', (c) => c.notNull())
    .addColumn('created_at', sql.raw('datetime(3)'), (c) => c.notNull())
    .execute();
}
