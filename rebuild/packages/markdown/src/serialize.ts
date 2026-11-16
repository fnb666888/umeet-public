import { unified } from 'unified';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { DocumentAst } from './parse.js';
export function serializeMarkdown(ast: DocumentAst): string {
  return unified().use(remarkStringify).use(remarkGfm).use(remarkMath).stringify(ast);
}
