import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
 await sql`ALTER TABLE external_identities MODIFY provider VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, MODIFY subject VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`.execute(db);
}
