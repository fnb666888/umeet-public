import { connectDatabase } from '../apps/api/dist/apps/api/src/database/connection.js';
import { migrate } from '../apps/api/dist/apps/api/src/database/migrate.js';
import { sql } from 'kysely';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
const db = connectDatabase(process.env.DATABASE_URL);
try {
  const result = await sql`SELECT VERSION() AS engine_version`.execute(db);
  const version = String(result.rows[0]?.engine_version || '');
  if (!/^8\./.test(version) && !/TiDB/i.test(version)) throw new Error('MYSQL_8_OR_TIDB_REQUIRED');
  await migrate(db);
  console.log('MySQL-compatible schema migrations completed.');
} catch (error) {
  const safe =
    typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'DATABASE_MIGRATION_FAILED';
  console.error(safe);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
