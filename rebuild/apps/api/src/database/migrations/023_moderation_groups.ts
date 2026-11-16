import type { Kysely } from 'kysely';

export async function up<DB>(db: Kysely<DB>) {
  await db.schema
    .createTable('moderation_groups')
    .ifNotExists()
    .addColumn('id', 'varchar(36)', (column) => column.primaryKey())
    .addColumn('name', 'varchar(80)', (column) => column.notNull().unique())
    .addColumn('boards', 'text', (column) => column.notNull())
    .addColumn('permissions', 'text', (column) => column.notNull())
    .execute();
  await db.schema
    .createTable('moderation_group_members')
    .ifNotExists()
    .addColumn('group_id', 'varchar(36)', (column) =>
      column.notNull().references('moderation_groups.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'varchar(36)', (column) => column.notNull())
    .addPrimaryKeyConstraint('moderation_group_member_pk', ['user_id', 'group_id'])
    .execute();
}
