import { sql, type Kysely } from 'kysely';

export async function up<DB>(db: Kysely<DB>): Promise<void> {
  const users = (await db.introspection.getTables()).find((table) => table.name === 'users');
  if (!users?.columns.some((column) => column.name === 'deleted_at'))
    await db.schema
      .alterTable('users')
      .addColumn('deleted_at', sql`datetime(3)`)
      .execute();
}
