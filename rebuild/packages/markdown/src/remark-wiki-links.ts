import type { Root, Parent, Link, Text } from 'mdast';
import { extractWikiLinks } from './links.ts';
import { parseMarkdown } from './parse.ts';
export default function remarkWikiLinks(options: { communitySlug: string }) {
  return function transform(root: Root): void {
    function visit(parent: Parent): void {
      const children = parent.children.flatMap((node) => {
        if (['code', 'inlineCode', 'math', 'inlineMath', 'link', 'image'].includes(node.type))
          return [node];
        if (node.type !== 'text') {
          if ('children' in node) visit(node as Parent);
          return [node];
        }
        const result: (Text | Link)[] = [];
        let offset = 0;
        for (const match of node.value.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          const reference = extractWikiLinks(parseMarkdown(match[0]), options.communitySlug)[0];
          if (!reference) continue;
          if (match.index > offset)
            result.push({ type: 'text', value: node.value.slice(offset, match.index) });
          result.push({
            type: 'link',
            url:
              '/c/' +
              encodeURIComponent(reference.communitySlug) +
              '/wiki/' +
              encodeURIComponent(reference.slug),
            children: [{ type: 'text', value: reference.label }],
          });
          offset = match.index + match[0].length;
        }
        if (offset < node.value.length)
          result.push({ type: 'text', value: node.value.slice(offset) });
        return result;
      });
      parent.children = children;
    }
    visit(root);
  };
}
