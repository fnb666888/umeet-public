import type { Kysely } from 'kysely';
import type { Database } from '../database.types.js';
import { generateUsername } from '../../modules/identity/username.js';

export async function up<DB>(database: Kysely<DB>): Promise<void> {
  const db = database as unknown as Kysely<Database>;
  const users = (await db.introspection.getTables()).find((table) => table.name === 'users');
  if (!users?.columns.some((column) => column.name === 'username_changes'))
    await db.schema
      .alterTable('users')
      .addColumn('username_changes', 'integer', (c) => c.notNull().defaultTo(0))
      .execute();
  await db.transaction().execute(async (tx) => {
    const members = await tx
      .selectFrom('users')
      .selectAll()
      .where('kind', '=', 'member')
      .where('deleted_at', 'is', null)
      .where('merged_into', 'is', null)
      .forUpdate()
      .execute();
    for (const member of members) {
      const handle = member.handle || (await generateUsername(tx));
      await tx
        .updateTable('users')
        .set({ handle, nickname: handle, onboarded_at: member.onboarded_at || new Date() })
        .where('id', '=', member.id)
        .execute();
    }
  });
}
