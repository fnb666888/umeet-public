import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('demo_content')
    .ifNotExists()
    .addColumn('id', 'varchar(16)', (c) => c.primaryKey())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('data', sql`mediumtext`, (c) => c.notNull())
    .addColumn('updated_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('demo_user_states')
    .ifNotExists()
    .addColumn('user_id', 'varchar(64)', (c) => c.primaryKey().references('users.id'))
    .addColumn('data', sql`mediumtext`, (c) => c.notNull())
    .addColumn('updated_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('demo_operations')
    .ifNotExists()
    .addColumn('id', 'varchar(120)', (c) => c.primaryKey())
    .addColumn('request_hash', 'varchar(64)', (c) => c.notNull())
    .addColumn('created_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('demo_messages')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('sender_id', 'varchar(64)', (c) => c.notNull().references('users.id'))
    .addColumn('recipient_id', 'varchar(64)', (c) => c.notNull().references('users.id'))
    .addColumn('text', 'varchar(2000)', (c) => c.notNull())
    .addColumn('post_id', 'varchar(64)')
    .addColumn('read_at', sql`datetime(3)`)
    .addColumn('created_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
  await sql`INSERT INTO demo_content (id,version,data,updated_at) VALUES ('global',0,'{"posts":[],"comments":{},"wiki":[],"notifications":[]}',${new Date()}) ON DUPLICATE KEY UPDATE id=id`.execute(
    db,
  );
}
