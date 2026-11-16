import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { ensureDatabase } from './init-db.mjs';

// One cloud service: gateway + API + worker. A child failure restarts the whole instance.
const require = createRequire(import.meta.url);
require('../../apps/api/dist/core/config.js').checkConfig();
const children = new Set();
let stopping = false;
let forceTimer;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  forceTimer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 20000);
  forceTimer.unref();
  if (!children.size) clearTimeout(forceTimer);
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
function launch(name, file, args, env = process.env, persistent = true) {
  const child = spawn(file, args, { env, stdio: 'inherit' });
  children.add(child);
  child.on('error', () => {
    console.error(`${name} could not start`);
    stop(1);
  });
  child.on('exit', (code) => {
    children.delete(child);
    if (stopping) {
      if (!children.size) clearTimeout(forceTimer);
    } else if (persistent) {
      console.error(`${name} exited (${code ?? 'signal'}); restarting instance`);
      stop(1);
    }
  });
  return child;
}
async function main() {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3100)
    throw new Error('Invalid gateway port');
  writeFileSync('/tmp/umeet-nginx.conf', readFileSync('/app/deploy/cloudrun/nginx.conf', 'utf8').replace('listen 8080;', `listen ${port};`));
  await ensureDatabase();
  const migrate = launch('migrate', process.execPath, [
    '/opt/migrate/node_modules/prisma/build/index.js', 'migrate', 'deploy',
    '--config', '/opt/migrate/prisma.config.mjs',
  ], process.env, false);
  const migrated = await new Promise((resolve) => {
    migrate.once('error', () => resolve(false));
    migrate.once('exit', (code) => resolve(code === 0));
  });
  if (!migrated || stopping) return stop(1);
  launch('API', process.execPath, ['apps/api/dist/main.js'], {
    ...process.env, HOST: '127.0.0.1', PORT: '3100', PROCESS_ROLE: 'api', TRUST_PROXY: '1',
  });
  let healthy = false;
  const deadline = Date.now() + 90000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3100/api/v1/health', {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok && (await response.json()).status === 'ok') { healthy = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (stopping) return;
  if (!healthy) {
    console.error('API startup health check failed');
    return stop(1);
  }
  launch('worker', process.execPath, ['apps/api/dist/worker.js']);
  launch('gateway', '/usr/sbin/nginx', ['-c', '/tmp/umeet-nginx.conf', '-g', 'daemon off;']);
}
main().catch(() => { console.error('Cloud service startup failed'); stop(1); });
