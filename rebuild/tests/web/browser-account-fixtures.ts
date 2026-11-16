/** Reset only authentication test counters in the fixed disposable preview database. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { connectDatabase } from '../../apps/api/src/database/connection.js';
if (process.env.NODE_ENV === 'production') throw new Error('LOCAL_TEST_ONLY');
const db = connectDatabase('mysql://root@127.0.0.1:19316/umeet_rebuild_test_knowledgebrowser');
try {
  const fixture = JSON.parse(readFileSync('.runtime/local-role-accounts.json', 'utf8'));
  if (fixture.database !== 'umeet_rebuild_test_knowledgebrowser' || fixture.accounts.length !== 5)
    throw new Error('INVALID_LOCAL_FIXTURE');
  const keys = ['login-network:127.0.0.1', 'login-network:::ffff:127.0.0.1'];
  for (const account of fixture.accounts) {
    if (!/^umeet_test_(admin|mod|helper|user|user_b)$/.test(account.username))
      throw new Error('UNOWNED_ACCOUNT');
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('handle', '=', account.username)
      .executeTakeFirst();
    if (user?.id !== account.userId) throw new Error('FIXTURE_USER_MISMATCH');
    keys.push('login-account:' + account.username);
  }
  await db
    .deleteFrom('auth_attempts')
    .where(
      'key_hash',
      'in',
      keys.map((key) => createHash('sha256').update(key).digest('hex')),
    )
    .execute();
  console.log('Prepared local QA login counters; rate limits remain enabled.');
} finally {
  await db.destroy();
}
