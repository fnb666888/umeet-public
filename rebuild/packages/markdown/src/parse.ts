import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Root } from 'mdast';
export type DocumentAst = Root;
export function parseMarkdown(source: string): DocumentAst {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(source);
}
