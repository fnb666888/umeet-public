import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
 await sql`ALTER TABLE jobs MODIFY available_at DATETIME(3) NOT NULL, MODIFY lease_expires_at DATETIME(3) NULL`.execute(db);
}
