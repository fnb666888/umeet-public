import { sql, type Kysely } from 'kysely';

export async function up<DB>(db: Kysely<DB>) {
  await db.schema
    .createTable('community_restrictions')
    .ifNotExists()
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('board', 'varchar(32)', (c) => c.notNull())
    .addColumn('until_at', sql.raw('datetime(3)'), (c) => c.notNull())
    .addColumn('reason', 'varchar(500)', (c) => c.notNull())
    .addPrimaryKeyConstraint('community_restrictions_pk', ['user_id', 'board'])
    .execute();
  const tables = await db.introspection.getTables();
  if (
    !tables
      .find((table) => table.name === 'admin_actions')
      ?.columns.some((column) => column.name === 'board')
  )
    await db.schema.alterTable('admin_actions').addColumn('board', 'varchar(32)').execute();
}
