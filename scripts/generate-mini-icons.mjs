import { createRequire } from 'node:module';
const sharp = createRequire(new URL('../rebuild/package.json', import.meta.url))('sharp');
import { mkdirSync, writeFileSync } from 'node:fs';
const root = 'apps/miniprogram/src/assets';
mkdirSync(root, { recursive: true });
const icons = {
  community: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  knowledge:
    '<path d="M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v17h-5a4 4 0 0 0-4 1 4 4 0 0 0-4-1H3z"/>',
  messages:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M7 8h10M7 12h6"/>',
  me: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
};
for (const [name, path] of Object.entries(icons))
  for (const active of [false, true]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${active ? '#3568d4' : '#636b74'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    writeFileSync(`${root}/${name}${active ? '-active' : ''}.svg`, svg);
    await sharp(Buffer.from(svg))
      .resize(64, 64)
      .png()
      .toFile(`${root}/${name}${active ? '-active' : ''}.png`);
  }
