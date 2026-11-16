import type { Node, Parent } from 'unist';
export function walk(node: Node, visit: (node: Node) => boolean | void): void {
  if (visit(node) === false) return;
  if ('children' in node && Array.isArray(node.children))
    for (const child of (node as Parent).children) walk(child, visit);
}
