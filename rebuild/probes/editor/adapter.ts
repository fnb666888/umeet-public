import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { getMarkdown } from '@milkdown/kit/utils';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export function normalizeMarkdown(source: string): unknown {
  const tree: unknown = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(source);
  function clean(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clean);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'position').map(([key, val]) => [key, clean(val)]));
    }
    return value;
  }
  return clean(tree);
}

export async function convertThroughEditor(source: string): Promise<string> {
  if (/<\/?[a-z][^>]*>/i.test(source)) throw new Error('UNSUPPORTED_HTML');
  const root = document.createElement('div');
  document.body.append(root);
  const editor = Editor.make().config(ctx => {
    ctx.set(rootCtx, root);
    ctx.set(defaultValueCtx, source);
  }).use(commonmark).use(gfm);
  try {
    await editor.create();
    return editor.action(getMarkdown());
  } finally {
    await editor.destroy();
    root.remove();
  }
}
