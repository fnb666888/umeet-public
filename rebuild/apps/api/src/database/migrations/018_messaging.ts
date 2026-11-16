import { sql, type Kysely } from 'kysely';
import { createHash } from 'node:crypto';
import type { Database } from '../database.types.js';

export async function up<DB>(database: Kysely<DB>) {
  const db = database as unknown as Kysely<Database>;
  await db.schema
    .createTable('dm_conversations')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('first_user', 'varchar(64)', (c) => c.notNull())
    .addColumn('second_user', 'varchar(64)', (c) => c.notNull())
    .addColumn('requested_by', 'varchar(64)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull())
    .addColumn('updated_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('dm_members')
    .ifNotExists()
    .addColumn('conversation_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('muted', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('blocked', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('hidden', 'integer', (c) => c.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('dm_members_pk', ['conversation_id', 'user_id'])
    .execute();
  await db.schema
    .createTable('dm_preferences')
    .ifNotExists()
    .addColumn('user_id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('allow_requests', 'integer', (c) => c.notNull().defaultTo(1))
    .execute();
  await db.schema
    .createTable('dm_reports')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('reporter_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('message_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('reason', 'varchar(500)', (c) => c.notNull())
    .addColumn('created_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
  const table = (await db.introspection.getTables()).find((t) => t.name === 'demo_messages');
  if (!table?.columns.some((c) => c.name === 'conversation_id'))
    await db.schema
      .alterTable('demo_messages')
      .addColumn('conversation_id', 'varchar(64)')
      .execute();
  const rows = await db
    .selectFrom('demo_messages')
    .selectAll()
    .where('conversation_id', 'is', null)
    .orderBy('created_at')
    .execute();
  for (const row of rows) {
    const [first, second] = [row.sender_id, row.recipient_id].sort() as [string, string];
    const id = createHash('sha256')
      .update(first + ':' + second)
      .digest('hex');
    await db
      .insertInto('dm_conversations')
      .values({
        id,
        first_user: first,
        second_user: second,
        requested_by: row.sender_id,
        status: 'accepted',
        updated_at: row.created_at,
      })
      .onDuplicateKeyUpdate({ updated_at: row.created_at })
      .execute();
    for (const user_id of [first, second])
      await db
        .insertInto('dm_members')
        .values({ conversation_id: id, user_id, muted: 0, blocked: 0, hidden: 0 })
        .onDuplicateKeyUpdate({ user_id })
        .execute();
    await db
      .updateTable('demo_messages')
      .set({ conversation_id: id })
      .where('id', '=', row.id)
      .execute();
  }
  const indexes = await sql<{ Key_name: string }>`SHOW INDEX FROM demo_messages`.execute(db);
  if (!indexes.rows.some((row) => row.Key_name === 'dm_history'))
    await db.schema
      .createIndex('dm_history')
      .on('demo_messages')
      .columns(['conversation_id', 'created_at', 'id'])
      .execute();
}
