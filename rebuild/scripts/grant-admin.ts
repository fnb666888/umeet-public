import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../apps/api/src/database/connection.js';
import { migrate } from '../apps/api/src/database/migrate.js';

const username = process.argv[2];
const url = process.env['DATABASE_URL'];
if (!username || !url) throw new Error('Provide a username and DATABASE_URL');
const db = connectDatabase(url);
try {
  await migrate(db);
  await db.transaction().execute(async (tx) => {
    const user = await tx
      .selectFrom('users')
      .select(['id', 'nickname'])
      .where('handle', '=', username.toLowerCase())
      .where('kind', '=', 'member')
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!user) throw new Error('Active account not found');
    const existing = await tx
      .selectFrom('platform_roles')
      .select('role')
      .where('user_id', '=', user.id)
      .where('role', 'in', ['owner', 'admin'])
      .executeTakeFirst();
    if (existing) {
      console.log('Administrator access already enabled for ' + user.nickname);
      return;
    }
    const owner = await tx
      .selectFrom('platform_roles')
      .select('user_id')
      .where('role', '=', 'owner')
      .executeTakeFirst();
    await tx
      .insertInto('platform_roles')
      .values({ user_id: user.id, role: owner ? 'admin' : 'owner' })
      .execute();
    await tx
      .insertInto('audit_events')
      .values({
        id: randomUUID(),
        actor_id: null,
        kind: 'admin.granted',
        target_id: user.id,
        reason: 'Administrator granted through server command',
      })
      .execute();
    console.log('Administrator access enabled for ' + user.nickname);
  });
} finally {
  await db.destroy();
}
