import { readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
function copy(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const src = path.join(dir, e.name);
    if (e.isDirectory()) copy(src);
    else if (!src.endsWith('.ts')) {
      const out = path.join('dist', path.relative('src', src));
      mkdirSync(path.dirname(out), { recursive: true });
      copyFileSync(src, out);
    }
  }
}
copy('src');
