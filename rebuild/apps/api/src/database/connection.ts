import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { Database } from './database.types.js';
export function connectDatabase(connectionString: string): Kysely<Database> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL_INVALID');
  }
  if (url.protocol !== 'mysql:' || !url.pathname.slice(1)) throw new Error('DATABASE_URL_INVALID');
  const sslParam = url.searchParams.get('ssl');
  const tidb = url.hostname.endsWith('.tidbcloud.com');
  let tls = tidb;
  if (sslParam !== null) {
    let value: unknown;
    try {
      value = JSON.parse(sslParam);
    } catch {
      throw new Error('DATABASE_TLS_INVALID');
    }
    if (value === true) tls = true;
    else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      (value as { rejectUnauthorized?: unknown }).rejectUnauthorized === true
    )
      tls = true;
    else throw new Error('DATABASE_TLS_VALIDATION_REQUIRED');
  }
  return new Kysely<Database>({
    dialect: new MysqlDialect({
      pool: createPool({
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)),
        connectionLimit: 5,
        connectTimeout: 15000,
        timezone: 'Z',
        charset: 'utf8mb4',
        ...(tls
          ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true, verifyIdentity: true } }
          : {}),
      }),
    }),
  });
}
