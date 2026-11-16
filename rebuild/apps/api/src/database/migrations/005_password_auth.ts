import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
 await db.schema.createTable('password_credentials').addColumn('username','varchar(64)',c=>c.primaryKey()).addColumn('user_id','varchar(64)',c=>c.notNull().unique().references('users.id')).addColumn('password_hash','varchar(255)',c=>c.notNull()).execute();
 await db.schema.createTable('sessions').addColumn('token_hash','varchar(64)',c=>c.primaryKey()).addColumn('user_id','varchar(64)',c=>c.notNull().references('users.id')).addColumn('expires_at',sql`datetime(3)`,c=>c.notNull()).execute();
 await db.schema.createIndex('sessions_user').on('sessions').column('user_id').execute();
 await db.schema.createTable('auth_attempts').addColumn('key_hash','varchar(64)',c=>c.primaryKey()).addColumn('attempts','integer',c=>c.notNull()).addColumn('expires_at',sql`datetime(3)`,c=>c.notNull()).execute();
}
