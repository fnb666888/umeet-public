import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';

const root = process.cwd();
const runtime = process.env.MYSQL_TEST_RUNTIME || path.join(root, 'artifacts/mysql-test-runtime/server/mysql-8.4.11-winx64');
const binary = path.join(runtime, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');
const dir = mkdtempSync(path.join(os.tmpdir(), 'umeet-mysql-tests-'));
const datadir = path.join(dir, 'data');
mkdirSync(datadir);
const port = 53306;
const name = 'umeet_tests_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const env = { ...process.env, DATABASE_PROVIDER: 'mysql', NODE_OPTIONS: '--max-old-space-size=384 --max-semi-space-size=8',
  DATABASE_URL: `mysql://umeet_test:${password}@127.0.0.1:${port}/${name}` };
env.UMEET_TEST_DATABASE_URL = env.DATABASE_URL;
function run(file, args, cwd = root, childEnv = env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: childEnv, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Test step failed (${code})`)));
  });
}
let server, connection;
try {
  await run(process.execPath, ['../../node_modules/prisma/build/index.js', 'generate'], path.join(root, 'apps/api'), { ...env, NODE_OPTIONS: '--max-old-space-size=256 --max-semi-space-size=4' });
  await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json']);
  console.log('Initializing isolated MySQL test instance on loopback');
  await run(binary, ['--no-defaults', '--initialize-insecure', `--basedir=${runtime}`, `--datadir=${datadir}`]);
  server = spawn(binary, ['--no-defaults', `--basedir=${runtime}`, `--datadir=${datadir}`, '--bind-address=127.0.0.1',
    `--port=${port}`, '--innodb-buffer-pool-size=32M', '--innodb-log-buffer-size=4M', '--performance-schema=OFF',
    '--table-open-cache=128', '--table-definition-cache=400', '--max-connections=20', '--skip-log-bin', '--console'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', data => process.stderr.write(data));
  server.on('error', () => {});
  for (let i = 0; i < 100; i++) {
    try { connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', connectTimeout: 1000 }); break; }
    catch { if (server.exitCode !== null) throw new Error('MySQL test server exited'); await new Promise(r => setTimeout(r, 300)); }
  }
  if (!connection) throw new Error('MySQL test server did not start');
  // Fresh, uniquely named test schema. This script never receives cloud credentials.
  await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query("CREATE USER 'umeet_test'@'127.0.0.1' IDENTIFIED BY ?", [password]);
  await connection.query(`GRANT ALL ON \`${name}\`.* TO 'umeet_test'@'127.0.0.1'`);
  await run(process.execPath, ['../../node_modules/prisma/build/index.js', 'migrate', 'deploy'], path.join(root, 'apps/api'), { ...env, NODE_OPTIONS: '--max-old-space-size=256 --max-semi-space-size=4' });
  await run(process.execPath, ['--test', '--test-isolation=none', '--test-concurrency=1', 'apps/api/test/community.test.cjs', 'apps/api/test/wxcloud-cos.test.cjs'], root, { ...env, NODE_OPTIONS: '--max-old-space-size=256 --max-semi-space-size=4' });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (connection) {
    await connection.query('SHUTDOWN').catch(() => {});
    await connection.end().catch(() => {});
  }
  if (server && server.exitCode === null) {
    await Promise.race([new Promise(r => server.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
    if (server.exitCode === null) server.kill();
  }
}
