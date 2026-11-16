/** Local preview only. Run fixture setup first; does not read deployment secrets. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
if (!existsSync('.runtime/mini-knowledge-fixture.json')) throw new Error('RUN_MINI_FIXTURE_FIRST');
const env = {
  ...process.env,
  DATABASE_URL: 'mysql://root@127.0.0.1:19316/umeet_rebuild_test_minibrowser',
  PORT: '3188',
  HOST: '127.0.0.1',
  API_BASE_URL: 'http://127.0.0.1:3188/api/v1',
  EMAIL_OTP_ENABLED: 'false',
  SMS_OTP_PROVIDER: 'disabled',
};
const api = spawn(process.execPath, ['--import', 'tsx', '--watch', 'apps/api/src/main.ts'], {
  cwd: process.cwd(),
  env,
  windowsHide: true,
  stdio: 'inherit',
});
const web = spawn(
  process.execPath,
  [resolve('node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '5178'],
  { cwd: resolve('apps/web'), env, windowsHide: true, stdio: 'inherit' },
);
let stopping = false;
function close() {
  if (stopping) return;
  stopping = true;
  api.kill();
  web.kill();
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
for (const child of [api, web]) {
  child.on('error', (error) => {
    console.error(error);
    close();
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    if (!stopping) {
      close();
      process.exitCode = code ?? 1;
    }
  });
}
