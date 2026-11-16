import { readFileSync, writeFileSync } from 'node:fs';
const web = readFileSync('rebuild/apps/web/public/demo/css/style.css', 'utf8');
const names = [
  'text-primary',
  'text-secondary',
  'surface',
  'surface-subtle',
  'surface-hover',
  'border',
  'action',
  'action-hover',
  'selected-bg',
  'success',
  'success-bg',
  'danger',
];
const rules = names
  .map((name) => {
    const match = web.match(new RegExp('--' + name + ':([^;]+);'));
    if (!match) throw new Error('MISSING_WEB_TOKEN ' + name);
    return '--' + name + ':' + match[1] + ';';
  })
  .join('');
writeFileSync(
  'apps/miniprogram/src/tokens.wxss',
  '/* Generated from the website semantic tokens. */\npage,.page{' +
    rules +
    '}\n.page.dark{--text-primary:#e5e9f0;--text-secondary:#a9b1bc;--surface:#171b22;--surface-subtle:#222833;--surface-hover:#2b3442;--border:#36404d;--selected-bg:#223557;}\n',
);
