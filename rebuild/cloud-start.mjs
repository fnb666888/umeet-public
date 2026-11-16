import { createConnection } from 'mysql2/promise';
import { connectDatabase } from './apps/api/dist/apps/api/src/database/connection.js';
import { migrate } from './apps/api/dist/apps/api/src/database/migrate.js';

const schema = 'umeet_rebuild';
try {
  const { MYSQL_ADDRESS: address, MYSQL_USERNAME: user, MYSQL_PASSWORD: password } = process.env;
  if (!address || !user || !password) throw new Error('MYSQL_CONFIGURATION_INCOMPLETE');
  const url = new URL('mysql://' + address);
  if (!url.hostname || url.username || url.password || url.pathname || url.search || url.hash) {
    throw new Error('MYSQL_ADDRESS_INVALID');
  }
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  url.pathname = '/' + schema;
  const options = { host: url.hostname, port: Number(url.port || 3306), user, password };
  let connection;
  try {
    connection = await createConnection({ ...options, database: schema });
  } catch (error) {
    if (error.code !== 'ER_BAD_DB_ERROR') throw error;
    const bootstrap = await createConnection(options);
    try {
      await bootstrap.query('CREATE DATABASE IF NOT EXISTS `umeet_rebuild` CHARACTER SET utf8mb4');
    } finally {
      await bootstrap.end();
    }
    connection = await createConnection({ ...options, database: schema });
  }
  try {
    const [[row]] = await connection.query('SELECT VERSION() AS engineVersion');
    if (!/^8\./.test(row.engineVersion)) throw new Error('MYSQL_8_REQUIRED');
  } finally {
    await connection.end();
  }
  process.env.DATABASE_URL = url.href;
  const db = connectDatabase(url.href);
  try {
    await migrate(db);
  } finally {
    await db.destroy();
  }
  console.log('MySQL 8 connection and rebuild schema verified.');
  await import('./apps/api/dist/apps/api/src/main.js');
} catch (error) {
  const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'STARTUP_FAILED';
  console.error('Umeet startup failed:', code);
  process.exitCode = 1;
}
