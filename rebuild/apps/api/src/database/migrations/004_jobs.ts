import {type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
 await db.schema.createTable('jobs').addColumn('id','varchar(64)',c=>c.primaryKey()).addColumn('kind','varchar(80)',c=>c.notNull()).addColumn('business_key','varchar(200)',c=>c.notNull().unique()).addColumn('payload','text',c=>c.notNull()).addColumn('state','varchar(20)',c=>c.notNull()).addColumn('attempts','integer',c=>c.notNull().defaultTo(0)).addColumn('available_at','datetime',c=>c.notNull()).addColumn('lease_owner','varchar(100)').addColumn('lease_token','varchar(64)').addColumn('lease_expires_at','datetime').addColumn('last_error','varchar(80)').execute();
 await db.schema.createIndex('job_queue').on('jobs').columns(['state','available_at']).execute();
}
