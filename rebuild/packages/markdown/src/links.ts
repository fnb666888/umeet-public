import type { DocumentAst } from './parse.js';
import { walk } from './walk.ts';
export type WikiReference = { communitySlug: string; slug: string; label: string };
export function extractWikiLinks(ast: DocumentAst, communitySlug: string): WikiReference[] {
  const result = new Map<string, WikiReference>();
  walk(ast, (node) => {
    if (['code', 'inlineCode', 'math', 'inlineMath', 'link', 'image'].includes(node.type))
      return false;
    if (node.type === 'text' && 'value' in node && typeof node.value === 'string') {
      for (const match of node.value.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
        const [target, caption] = match[1]!.split('|');
        const parts = target!.trim().split('/');
        const community = (parts.length === 2 ? parts[0] : communitySlug) || '',
          slug = (parts.length === 2 ? parts[1] : parts[0]) || '';
        if (
          parts.length > 2 ||
          !/^[-a-z0-9_]+$/.test(community) ||
          !/^[-\p{L}\p{N}_]+$/u.test(slug)
        )
          continue;
        const reference = {
          communitySlug: community,
          slug: slug.normalize('NFKC').toLowerCase(),
          label: caption?.trim() || slug,
        };
        result.set(community + '/' + reference.slug, reference);
      }
    }
  });
  return [...result.values()];
}
export function extractAttachments(ast: DocumentAst): string[] {
  const urls = new Set<string>();
  walk(ast, (node) => {
    if (
      'url' in node &&
      typeof node.url === 'string' &&
      (node.type === 'image' || node.url.startsWith('/media/'))
    )
      urls.add(node.url);
  });
  return [...urls].sort();
}
