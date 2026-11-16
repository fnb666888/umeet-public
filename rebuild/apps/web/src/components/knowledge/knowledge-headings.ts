import type { Nodes, Root } from 'mdast';
import { parseMarkdown } from '../../../../../packages/markdown/src/parse';
function text(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if ('children' in node) return node.children.map(text).join('');
  return '';
}
export function knowledgeHeadings(markdown: string) {
  const headings: { id: string; title: string; level: number }[] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'heading')
      headings.push({ id: 'section-' + headings.length, title: text(node), level: node.depth });
    if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(parseMarkdown(markdown));
  return headings;
}
export function remarkKnowledgeHeadings() {
  return (tree: Root) => {
    let index = 0;
    const visit = (node: Nodes) => {
      if (node.type === 'heading')
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, id: 'section-' + index++ },
        };
      if ('children' in node) for (const child of node.children) visit(child);
    };
    visit(tree);
  };
}
