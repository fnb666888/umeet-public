import type {Kysely} from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
 await db.schema.createTable('wiki_links').addColumn('revision_id','varchar(64)',c=>c.notNull().references('wiki_revisions.id')).addColumn('source_page_id','varchar(64)',c=>c.notNull().references('wiki_pages.id')).addColumn('target_community_slug','varchar(80)',c=>c.notNull()).addColumn('target_slug','varchar(160)',c=>c.notNull()).addColumn('label','varchar(200)',c=>c.notNull()).addPrimaryKeyConstraint('wiki_link_pk',['revision_id','target_community_slug','target_slug']).execute();
 await db.schema.createIndex('wiki_link_target').on('wiki_links').columns(['target_community_slug','target_slug']).execute();
}
