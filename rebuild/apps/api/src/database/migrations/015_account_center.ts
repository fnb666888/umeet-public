import { sql, type Kysely } from 'kysely';

export async function up<DB>(db: Kysely<DB>): Promise<void> {
  const tables = await db.introspection.getTables();
  const hasColumn = (table: string, column: string) =>
    tables.find((item) => item.name === table)?.columns.some((item) => item.name === column);
  if (!hasColumn('users', 'handle'))
    await db.schema.alterTable('users').addColumn('handle', 'varchar(32)').execute();
  if (!hasColumn('users', 'onboarded_at'))
    await db.schema
      .alterTable('users')
      .addColumn('onboarded_at', sql`datetime(3)`)
      .execute();
  await sql`UPDATE users u JOIN password_credentials p ON p.user_id = u.id SET u.handle = p.username WHERE u.handle IS NULL AND CHAR_LENGTH(p.username) <= 32`.execute(
    db,
  );
  const userIndexes = await sql<{
    INDEX_NAME: string;
  }>`SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'users_handle_unique'`.execute(
    db,
  );
  if (!userIndexes.rows.length)
    await db.schema
      .createIndex('users_handle_unique')
      .on('users')
      .column('handle')
      .unique()
      .execute();
  if (!hasColumn('sessions', 'id'))
    await db.schema.alterTable('sessions').addColumn('id', 'varchar(36)').execute();
  if (!hasColumn('sessions', 'device'))
    await db.schema
      .alterTable('sessions')
      .addColumn('device', 'varchar(240)', (c) => c.notNull().defaultTo('未知设备'))
      .execute();
  if (!hasColumn('sessions', 'created_at'))
    await db.schema
      .alterTable('sessions')
      .addColumn('created_at', sql`datetime(3)`, (c) =>
        c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
      )
      .execute();
  if (!hasColumn('sessions', 'last_seen_at'))
    await db.schema
      .alterTable('sessions')
      .addColumn('last_seen_at', sql`datetime(3)`, (c) =>
        c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
      )
      .execute();
  await sql`UPDATE sessions SET id = UUID() WHERE id IS NULL`.execute(db);
  const sessionIndexes = await sql<{
    INDEX_NAME: string;
  }>`SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sessions' AND INDEX_NAME = 'sessions_public_id'`.execute(
    db,
  );
  if (!sessionIndexes.rows.length)
    await db.schema
      .createIndex('sessions_public_id')
      .on('sessions')
      .column('id')
      .unique()
      .execute();
}
