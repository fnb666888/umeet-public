import { BadRequestException } from '@nestjs/common';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import sharp from 'sharp';
import { parseFragment } from 'parse5';
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const document = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams'], maxBuffer: 20000, maxMacros: 1000 }),
  OutputJax: new SVG({ fontCache: 'none' }),
});
type Node = {
  type: string;
  value?: string;
  url?: string;
  title?: string;
  alt?: string;
  depth?: number;
  ordered?: boolean;
  children?: Node[];
};
type Rich = {
  name?: string;
  attrs?: Record<string, string>;
  children?: Rich[];
  type?: 'text';
  text?: string;
};
let queue: Promise<unknown> = Promise.resolve();
const formulas = new Map<string, { src: string; width: number; height: number }>();
async function formula(tex: string, display: boolean, dark: boolean) {
  if (tex.length > 2000 || /\\(?:require|href|html|includegraphics|style)\b/.test(tex))
    throw new BadRequestException('FORMULA_UNSUPPORTED');
  const key = String(dark) + String(display) + tex;
  const old = formulas.get(key);
  if (old) return old;
  const work = queue
    .catch(() => {})
    .then(async () => {
      const output = await mathjax.handleRetriesFor(() => document.convert(tex, { display }));
      let svg = adaptor.outerHTML(adaptor.tags(output, 'svg')[0]!);
      if (svg.includes('data-mjx-error')) throw new BadRequestException('FORMULA_INVALID');
      const box = svg
        .match(/viewBox="([^"]+)"/)?.[1]
        ?.split(/\s+/)
        .map(Number);
      if (!box || box.length !== 4) throw new BadRequestException('FORMULA_INVALID');
      const width = Math.max(1, Math.ceil((box[2]! / 1000) * 22)),
        height = Math.max(1, Math.ceil((box[3]! / 1000) * 22));
      if (width > 4096 || height > 2048) throw new BadRequestException('FORMULA_TOO_LARGE');
      svg = svg
        .replace(/currentColor/g, dark ? '#e6eaf0' : '#1f2328')
        .replace(/width="[^"]+"/, `width="${width * 2}"`)
        .replace(/height="[^"]+"/, `height="${height * 2}"`);
      const png = await sharp(Buffer.from(svg), { limitInputPixels: 32_000_000 }).png().toBuffer();
      const result = { src: 'data:image/png;base64,' + png.toString('base64'), width, height };
      if (formulas.size >= 200) formulas.delete(formulas.keys().next().value!);
      formulas.set(key, result);
      return result;
    });
  queue = work;
  return work;
}
export async function renderMobileMarkdown(markdown: string, dark = false) {
  if (markdown.length > 500000) throw new BadRequestException('CONTENT_TOO_LARGE');
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(
      markdown.replace(
        /\[\[([^\]\n]+)\]\]/g,
        (_, title: string) => `[${title}](wiki:${encodeURIComponent(title)})`,
      ),
    ) as Node;
  const links: { label: string; url: string }[] = [];
  let mathCount = 0,
    nodeCount = 0;
  const text = (n: Node): string => n.value ?? n.children?.map(text).join('') ?? '';
  async function render(n: Node): Promise<Rich> {
    if (++nodeCount > 20000) throw new BadRequestException('CONTENT_TOO_COMPLEX');
    if (n.type === 'text' || n.type === 'html') return { type: 'text', text: n.value ?? '' };
    if (n.type === 'math' || n.type === 'inlineMath') {
      if (++mathCount > 100) throw new BadRequestException('TOO_MANY_FORMULAS');
      const f = await formula(n.value ?? '', n.type === 'math', dark);
      return {
        name: 'img',
        attrs: {
          src: f.src,
          alt: n.value ?? '',
          style: `width:${f.width}px;height:${f.height}px;vertical-align:middle;background:transparent;`,
        },
      };
    }
    if (n.type === 'image') {
      const url = n.url ?? '';
      return /^(https:\/\/|\/api\/backend\/demo\/assets\/)/.test(url)
        ? {
            name: 'img',
            attrs: { src: url, alt: n.alt ?? '', style: 'max-width:100%;height:auto;' },
          }
        : { type: 'text', text: n.alt ?? '[图片不可用]' };
    }
    if (n.type === 'link' && /^(wiki:|https:\/\/|\/knowledge\/)/.test(n.url ?? ''))
      links.push({ label: text(n), url: n.url! });
    const names: Record<string, string> = {
      paragraph: 'p',
      strong: 'strong',
      emphasis: 'em',
      delete: 'del',
      list: n.ordered ? 'ol' : 'ul',
      listItem: 'li',
      blockquote: 'blockquote',
      table: 'table',
      tableRow: 'tr',
      tableCell: 'td',
      inlineCode: 'code',
      code: 'pre',
      break: 'br',
      thematicBreak: 'hr',
      link: 'span',
    };
    const name = n.type === 'heading' ? 'h' + n.depth : (names[n.type] ?? 'div');
    const styles: Record<string, string> = {
      p: 'margin:8px 0;line-height:1.8;',
      table: 'border-collapse:collapse;min-width:100%;',
      td: 'border:1px solid #e3e6ea;padding:8px;',
      pre: `padding:12px;background:${dark ? '#222832' : '#f6f7f9'};white-space:pre;overflow:auto;`,
      blockquote: 'border-left:3px solid #3568d4;padding-left:12px;color:#636b74;',
      span: n.type === 'link' ? 'color:#3568d4;' : '',
    };
    return {
      name,
      attrs: { style: styles[name] ?? '' },
      children:
        n.value !== undefined
          ? [{ type: 'text', text: n.value }]
          : await Promise.all((n.children ?? []).map(render)),
    };
  }
  const blocks = [];
  for (const child of tree.children ?? [])
    blocks.push({
      wide: child.type === 'table' || child.type === 'code' || child.type === 'math',
      nodes: [await render(child)],
    });
  return { blocks, links: [...new Map(links.map((l) => [l.url, l])).values()] };
}

/** Website posts contain sanitized rich HTML; still project only supported native nodes. */
export function renderMobileHtml(html: string) {
  if (html.length > 30000) throw new BadRequestException('CONTENT_TOO_LARGE');
  const tree = parseFragment(html),
    links: { label: string; url: string }[] = [];
  const allowed = new Set([
    'p',
    'div',
    'span',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'del',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'br',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'a',
    'img',
  ]);
  const blocked = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'template',
    'svg',
    'math',
    'form',
    'input',
  ]);
  const text = (n: any): string => n.value ?? (n.childNodes ?? []).map(text).join('');
  let count = 0;
  const visit = (n: any): Rich[] => {
    if (++count > 10000) throw new BadRequestException('CONTENT_TOO_COMPLEX');
    if (n.nodeName === '#text') return [{ type: 'text', text: n.value }];
    if (blocked.has(n.tagName)) return [];
    const children = (n.childNodes ?? []).flatMap(visit);
    if (!allowed.has(n.tagName)) return children;
    const attrs = Object.fromEntries((n.attrs ?? []).map((a: any) => [a.name, a.value])) as Record<
      string,
      string
    >;
    if (n.tagName === 'img')
      return /^(https:\/\/|\/api\/backend\/demo\/assets\/)/.test(attrs.src ?? '')
        ? [
            {
              name: 'img',
              attrs: {
                src: attrs.src!,
                alt: attrs.alt ?? '',
                style: 'max-width:100%;height:auto;',
              },
            },
          ]
        : [];
    if (n.tagName === 'a' && /^(https:\/\/|\/knowledge\/)/.test(attrs.href ?? ''))
      links.push({ label: text(n), url: attrs.href! });
    return [
      {
        name: n.tagName === 'a' ? 'span' : n.tagName,
        attrs: {
          style:
            n.tagName === 'td' || n.tagName === 'th'
              ? 'border:1px solid #ddd;padding:8px;'
              : n.tagName === 'p'
                ? 'line-height:1.8;margin:8px 0;'
                : '',
        },
        children,
      },
    ];
  };
  return {
    blocks: tree.childNodes.map((n: any) => ({
      wide: ['table', 'pre'].includes(n.tagName),
      nodes: visit(n),
    })),
    links,
  };
}

export function postHtmlToMarkdown(html: string) {
  const tree = parseFragment(html);
  const plain = (n: any): string => n.value ?? (n.childNodes ?? []).map(plain).join('');
  const visit = (n: any): string => {
    if (['script', 'style', 'iframe', 'object', 'svg', 'form'].includes(n.tagName)) return '';
    if (n.nodeName === '#text') return n.value.replace(/([\\`*_{}\[\]<>])/g, '\\$1');
    const inside = (n.childNodes ?? []).map(visit).join(''),
      attrs = Object.fromEntries((n.attrs ?? []).map((a: any) => [a.name, a.value]));
    if (/^h[1-6]$/.test(n.tagName ?? ''))
      return '\n' + '#'.repeat(Number(n.tagName[1])) + ' ' + inside + '\n\n';
    if (n.tagName === 'strong' || n.tagName === 'b') return '**' + inside + '**';
    if (n.tagName === 'em' || n.tagName === 'i') return '*' + inside + '*';
    if (n.tagName === 'br') return '  \n';
    if (n.tagName === 'pre') return '\n```\n' + plain(n) + '\n```\n';
    if (n.tagName === 'code') return '`' + plain(n) + '`';
    if (n.tagName === 'li') return '\n- ' + inside.trim() + '\n';
    if (n.tagName === 'blockquote')
      return (
        '\n' +
        inside
          .trim()
          .split('\n')
          .map((x: string) => '> ' + x)
          .join('\n') +
        '\n'
      );
    if (n.tagName === 'a' && /^(https:\/\/|\/knowledge\/)/.test(attrs.href ?? ''))
      return '[' + inside + '](' + encodeURI(attrs.href) + ')';
    if (n.tagName === 'img' && /^(https:\/\/|\/api\/backend\/demo\/assets\/)/.test(attrs.src ?? ''))
      return '![' + (attrs.alt ?? '') + '](' + encodeURI(attrs.src) + ')';
    if (n.tagName === 'table') {
      const rows: any[] = [];
      const walk = (a: any) => {
        if (a.tagName === 'tr')
          rows.push(
            (a.childNodes ?? [])
              .filter((c: any) => ['td', 'th'].includes(c.tagName))
              .map((c: any) => plain(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')),
          );
        else (a.childNodes ?? []).forEach(walk);
      };
      walk(n);
      if (!rows.length) return '';
      return (
        '\n' +
        rows
          .map(
            (row, i) =>
              '|' +
              row.join('|') +
              '|' +
              (i === 0 ? '\n|' + row.map(() => '---').join('|') + '|' : ''),
          )
          .join('\n') +
        '\n'
      );
    }
    return ['p', 'div', 'ul', 'ol'].includes(n.tagName) ? '\n' + inside + '\n' : inside;
  };
  return tree.childNodes
    .map(visit)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export async function markdownPostHtml(markdown: string) {
  const content = await renderMobileMarkdown(markdown);
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = (n: Rich): string =>
    n.type === 'text'
      ? esc(n.text ?? '')
      : '<' +
        n.name +
        Object.entries(n.attrs ?? {})
          .map(([k, v]) => ' ' + k + '="' + esc(v) + '"')
          .join('') +
        '>' +
        (n.children ?? []).map(html).join('') +
        (['img', 'br', 'hr'].includes(n.name ?? '') ? '' : '</' + n.name + '>');
  const result = content.blocks
    .flatMap((b) => b.nodes)
    .map(html)
    .join('');
  if (result.length > 30000) throw new BadRequestException('POST_RICH_CONTENT_TOO_LARGE');
  return result;
}
