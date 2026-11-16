import { sql, type Kysely } from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
 await db.schema.createTable('users').addColumn('id','varchar(64)',c=>c.primaryKey()).addColumn('nickname','varchar(160)',c=>c.notNull()).addColumn('kind','varchar(16)',c=>c.notNull().defaultTo('guest')).addColumn('created_at','timestamp',c=>c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)).execute();
 await db.schema.createTable('audit_events').addColumn('id','varchar(64)',c=>c.primaryKey()).addColumn('actor_id','varchar(64)').addColumn('kind','varchar(80)',c=>c.notNull()).addColumn('target_id','varchar(100)',c=>c.notNull()).addColumn('reason','text',c=>c.notNull()).addColumn('created_at','timestamp',c=>c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)).execute();
}
