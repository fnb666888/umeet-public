import type { DocumentAst } from './parse.js';
import { walk } from './walk.ts';
export type ValidationResult = { valid: boolean; issues: { code: string; message: string }[] };
const supported = new Set([
  'root',
  'heading',
  'paragraph',
  'text',
  'strong',
  'emphasis',
  'delete',
  'blockquote',
  'list',
  'listItem',
  'break',
  'thematicBreak',
  'code',
  'inlineCode',
  'link',
  'image',
  'table',
  'tableRow',
  'tableCell',
  'definition',
  'linkReference',
  'imageReference',
  'footnoteDefinition',
  'footnoteReference',
  'math',
  'inlineMath',
]);
export function safeDocumentUrl(value: string, image = false): boolean {
  if (/[\u0000-\u0020\u007f]/.test(value) || value.startsWith('//') || value.includes('\\'))
    return false;
  try {
    const url = new URL(value, 'https://umeet.invalid');
    return (image ? ['https:', 'http:'] : ['https:', 'http:', 'mailto:']).includes(url.protocol);
  } catch {
    return false;
  }
}
export function validateDocument(ast: DocumentAst): ValidationResult {
  const issues: ValidationResult['issues'] = [];
  walk(ast, (node) => {
    if (!supported.has(node.type))
      issues.push({
        code: node.type === 'html' ? 'UNSUPPORTED_HTML' : 'UNSUPPORTED_STRUCTURE',
        message:
          node.type === 'html'
            ? '不支持直接嵌入 HTML，请使用 Markdown 格式。'
            : '正文含暂不支持的结构，请保留源码后调整。',
      });
    if (
      'url' in node &&
      typeof node.url === 'string' &&
      !safeDocumentUrl(node.url, node.type === 'image')
    )
      issues.push({
        code: 'UNSAFE_URL',
        message: '链接地址不安全，请使用正常网页或站内文件地址。',
      });
  });
  return { valid: issues.length === 0, issues };
}
