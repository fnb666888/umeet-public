import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
 await db.schema.alterTable('personal_records').modifyColumn('value',sql`mediumtext`,c=>c.notNull()).execute();
 await db.schema.alterTable('users').addColumn('merged_into','varchar(64)').execute();
}
