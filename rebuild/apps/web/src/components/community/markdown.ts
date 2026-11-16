import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent } from 'mdast';
import { cleanHtml } from './model';

const parser = unified().use(remarkParse).use(remarkGfm);
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
export function postMarkdownHtml(source: string) {
  function render(node: RootContent): string {
    const content = 'children' in node ? node.children.map(render).join('') : '';
    switch (node.type) {
      case 'text':
        return escape(node.value).replace(/\n/g, '<br>');
      case 'paragraph':
        return '<p>' + content + '</p>';
      case 'heading':
        return '<h' + node.depth + '>' + content + '</h' + node.depth + '>';
      case 'strong':
        return '<strong>' + content + '</strong>';
      case 'emphasis':
        return '<em>' + content + '</em>';
      case 'delete':
        return '<del>' + content + '</del>';
      case 'blockquote':
        return '<blockquote>' + content + '</blockquote>';
      case 'inlineCode':
        return '<code>' + escape(node.value) + '</code>';
      case 'code':
        return '<pre><code>' + escape(node.value) + '</code></pre>';
      case 'break':
        return '<br>';
      case 'thematicBreak':
        return '<hr>';
      case 'list':
        return node.ordered ? '<ol>' + content + '</ol>' : '<ul>' + content + '</ul>';
      case 'listItem':
        return (
          '<li>' +
          (node.checked === null || node.checked === undefined ? '' : node.checked ? '☑ ' : '☐ ') +
          content +
          '</li>'
        );
      case 'link':
        return '<a href="' + escape(node.url) + '">' + content + '</a>';
      case 'image':
        return escape(node.alt || '图片');
      case 'table':
        return '<table><tbody>' + content + '</tbody></table>';
      case 'tableRow':
        return '<tr>' + content + '</tr>';
      case 'tableCell':
        return '<td>' + content + '</td>';
      case 'html':
        return /^<\/?u>$/i.test(node.value.trim()) ? node.value.trim() : escape(node.value);
      default:
        return content;
    }
  }
  return cleanHtml(parser.parse(source).children.map(render).join(''));
}
