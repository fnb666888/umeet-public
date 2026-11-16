import mariadb from 'mariadb';

// 仅创建不存在的独立业务库，不重置数据库、不修改模板已有表。
export async function ensureDatabase() {
  const u = new URL(process.env.DATABASE_URL);
  const name = decodeURIComponent(u.pathname.slice(1));
  if (u.protocol !== 'mysql:' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name))
    throw new Error('Invalid application database name');
  const connection = await mariadb.createConnection({ host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), connectTimeout: 15000,
    ...(u.searchParams.get('sslaccept') === 'strict' ? { ssl: { rejectUnauthorized: true } } : {}) });
  try {
    const rows = await connection.query('SELECT VERSION() AS version');
    const version = String(rows[0].version);
    if (!/^(?:5\.7\.|8\.|9\.)/.test(version)) throw new Error('MySQL 5.7 or newer is required');
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log('MySQL application database is ready');
  } finally { await connection.end(); }
}
