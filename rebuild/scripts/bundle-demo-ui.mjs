import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../demo/web-ux/', import.meta.url));
const destination = fileURLToPath(new URL('../.runtime/demo-ui/', import.meta.url));
const assets = [
  'index.html',
  'css/style.css',
  'css/campus-map.svg',
  'js/data.js',
  'js/icons.js',
  'js/local.js',
  'js/features.js',
  'js/wiki.js',
  'js/app.js',
  'LUCIDE-LICENSE.txt',
];

for (const asset of assets) {
  const output = resolve(destination, asset);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(source, asset), output);
  const [original, bundled] = await Promise.all([readFile(resolve(source, asset)), readFile(output)]);
  if (!original.equals(bundled)) throw new Error('Demo asset changed during packaging: ' + asset);
}

console.log('Demo preview assets match the original files: ' + destination);
