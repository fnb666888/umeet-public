import {
  copyFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { Client } from 'pg';
// 只用于本机开发。复制二进制到 ASCII 缓存目录，解决中文工作区的 initdb 编码问题。
export async function windowsPostgres(databaseDir: string, url: URL) {
  const native = path.resolve(require.resolve('@embedded-postgres/windows-x64'), '../../native');
  const cache = path.join(os.tmpdir(), 'umeet-pg-binaries-18.4');
  function copyTree(source: string, target: string) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const a = path.join(source, entry.name),
        b = path.join(target, entry.name);
      if (entry.isDirectory()) copyTree(a, b);
      else copyFileSync(a, b);
    }
  }
  if (!existsSync(path.join(cache, 'bin/postgres.exe'))) copyTree(native, cache);
  mkdirSync(databaseDir, { recursive: true });
  if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) {
    const pwfile = databaseDir + '.init-password';
    writeFileSync(pwfile, url.password + '\n', { mode: 0o600 });
    try {
      execFileSync(
        path.join(cache, 'bin/initdb.exe'),
        [
          '-D',
          databaseDir,
          '-U',
          url.username,
          '--pwfile=' + pwfile,
          '--auth=scram-sha-256',
          '--encoding=UTF8',
          '--locale=C',
        ],
        { windowsHide: true, cwd: cache, stdio: 'pipe' },
      );
    } finally {
      if (existsSync(pwfile)) unlinkSync(pwfile);
    }
  }
  const child = spawn(
    path.join(cache, 'bin/postgres.exe'),
    ['-D', databaseDir, '-p', url.port, '-h', '127.0.0.1'],
    { windowsHide: true, cwd: cache, stdio: 'ignore' },
  );
  child.on('error', () => {});
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error('本地数据库未能启动，请检查端口占用');
    const client = new Client({
      host: '127.0.0.1',
      port: Number(url.port),
      user: url.username,
      password: url.password,
      database: 'postgres',
      connectionTimeoutMillis: 1000,
    });
    try {
      await client.connect();
      await client.end();
      ready = true;
      break;
    } catch {
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!ready) {
    child.kill();
    throw new Error('本地 PostgreSQL 启动超时');
  }
  const admin = new Client({
    host: '127.0.0.1',
    port: Number(url.port),
    user: url.username,
    password: url.password,
    database: 'postgres',
  });
  await admin.connect();
  const name = url.pathname.slice(1);
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('非法数据库名称');
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
    await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      execFileSync(path.join(cache, 'bin/pg_ctl.exe'), ['-D', databaseDir, 'stop', '-m', 'fast'], {
        windowsHide: true,
        cwd: cache,
        stdio: 'pipe',
      });
    } catch {
      child.kill();
    }
  };
  process.once('exit', () => {
    if (!stopped) void stop();
  });
  return { stop };
}
