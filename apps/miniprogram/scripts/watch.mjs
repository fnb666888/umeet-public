import { watch } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
execFileSync(process.execPath, ['scripts/copy.mjs'], { stdio: 'inherit' });
const compiler = spawn(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json', '--watch'],
  { stdio: 'inherit', windowsHide: true },
);
let timer;
const watcher = watch('src', { recursive: true }, (_event, file) => {
  if (file && !file.endsWith('.ts')) {
    clearTimeout(timer);
    timer = setTimeout(
      () => execFileSync(process.execPath, ['scripts/copy.mjs'], { stdio: 'inherit' }),
      150,
    );
  }
});
process.once('SIGINT', () => {
  compiler.kill();
  watcher.close();
  process.exit(0);
});
process.once('SIGTERM', () => {
  compiler.kill();
  watcher.close();
  process.exit(0);
});
