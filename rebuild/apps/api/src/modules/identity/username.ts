import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';

export async function generateUsername(db: Kysely<Database>): Promise<string> {
  for (;;) {
    const handle = 'user_' + randomUUID().replaceAll('-', '').slice(0, 12);
    const [user, credential] = await Promise.all([
      db.selectFrom('users').select('id').where('handle', '=', handle).executeTakeFirst(),
      db
        .selectFrom('password_credentials')
        .select('user_id')
        .where('username', '=', handle)
        .executeTakeFirst(),
    ]);
    if (!user && !credential) return handle;
  }
}
