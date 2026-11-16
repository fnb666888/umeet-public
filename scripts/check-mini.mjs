import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse } from '@vue/compiler-dom';

const root = path.resolve('apps/miniprogram/dist');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const pages = [
  ...app.pages,
  ...app.subPackages.flatMap((p) => p.pages.map((n) => p.root + '/' + n)),
];
const require = createRequire(import.meta.url);
let current;
globalThis.Page = (definition) => {
  current = definition;
};
globalThis.Component = (definition) => {
  current = definition.methods;
};
const definitions = [...pages, 'components/post-card/index'];
for (const name of definitions) {
  for (const ext of ['.js', '.json', '.wxml'])
    if (!fs.existsSync(path.join(root, name + ext))) throw new Error('缺失资源：' + name + ext);
  JSON.parse(fs.readFileSync(path.join(root, name + '.json'), 'utf8'));
  const source = fs.readFileSync(path.join(root, name + '.wxml'), 'utf8');
  for(const match of source.matchAll(/{{[\s\S]*?}}/g)) {if(/[\r\n]/.test(match[0]))throw new Error(name+' 模板表达式跨行，可能被格式化器拆断字符串');}
  parse(source); // 检查标记结构；不能代替微信编译器。
  current = null;
  require(path.join(root, name + '.js'));
  for (const [, handler] of source.matchAll(/(?:bind|catch)(?::)?[a-z]+="([^"]+)"/g)) {
    if (!handler.includes('{{') && typeof current?.[handler] !== 'function')
      throw new Error(name + ' 缺失事件处理：' + handler);
  }
}
for (const page of app.tabBar.list)
  if (!app.pages.includes(page.pagePath)) throw new Error('无效 tabBar 页面');
console.log(
  '小程序资源检查通过：' +
    pages.length +
    ' 个页面，组件与事件绑定齐全。微信编译/真机仍需另行验证。',
);
