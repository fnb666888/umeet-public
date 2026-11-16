import type { Kysely } from 'kysely';
import type { Database } from '../database.types.js';
export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable('knowledge_links')
    .ifNotExists()
    .addColumn('revision_id', 'varchar(64)', (c) =>
      c.notNull().references('knowledge_revisions.id'),
    )
    .addColumn('source_page_id', 'varchar(64)', (c) => c.notNull().references('knowledge_pages.id'))
    .addColumn('target_page_id', 'varchar(64)', (c) => c.notNull().references('knowledge_pages.id'))
    .addPrimaryKeyConstraint('knowledge_link_pk', ['revision_id', 'target_page_id'])
    .execute();
  await db.schema
    .createIndex('knowledge_link_target')
    .on('knowledge_links')
    .column('target_page_id')
    .execute();
}
