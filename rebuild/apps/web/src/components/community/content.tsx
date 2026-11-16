import { Fragment, type ReactNode } from 'react';
import { cleanHtml, plainText, type Wiki } from './model';

export function RichText({ html }: { html: string }) {
  const template = document.createElement('template');
  template.innerHTML = cleanHtml(html);
  function render(node: ChildNode, key: number): ReactNode {
    if (node.nodeType === 3) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;
    const children = [...node.childNodes].map(render);
    const props = { children };
    switch (node.tagName) {
      case 'BR':
        return <br key={key} />;
      case 'STRONG':
      case 'B':
        return <strong key={key} {...props} />;
      case 'EM':
      case 'I':
        return <em key={key} {...props} />;
      case 'U':
        return <u key={key} {...props} />;
      case 'DEL':
      case 'S':
        return <s key={key} {...props} />;
      case 'H1':
        return <h1 key={key} {...props} />;
      case 'H4':
        return <h4 key={key} {...props} />;
      case 'H5':
        return <h5 key={key} {...props} />;
      case 'H6':
        return <h6 key={key} {...props} />;
      case 'HR':
        return <hr key={key} />;
      case 'TABLE':
        return <table key={key} {...props} />;
      case 'THEAD':
        return <thead key={key} {...props} />;
      case 'TBODY':
        return <tbody key={key} {...props} />;
      case 'TR':
        return <tr key={key} {...props} />;
      case 'TH':
        return <th key={key} {...props} />;
      case 'TD':
        return <td key={key} {...props} />;
      case 'H2':
        return <h2 key={key} {...props} />;
      case 'H3':
        return <h3 key={key} {...props} />;
      case 'BLOCKQUOTE':
        return <blockquote key={key} {...props} />;
      case 'PRE':
        return <pre key={key} {...props} />;
      case 'CODE':
        return <code key={key} {...props} />;
      case 'UL':
        return <ul key={key} {...props} />;
      case 'OL':
        return <ol key={key} {...props} />;
      case 'LI':
        return <li key={key} {...props} />;
      case 'A':
        return (
          <a
            key={key}
            {...props}
            href={node.getAttribute('href') || undefined}
            rel="nofollow ugc noopener noreferrer"
          />
        );
      case 'DIV':
        return <div key={key} {...props} />;
      default:
        return <p key={key} {...props} />;
    }
  }
  return <>{[...template.content.childNodes].map(render)}</>;
}
export function WikiText({ text, wiki }: { text: string; wiki: Wiki[] }) {
  function inline(line: string) {
    return line.split(/(\[\[[^\]]+\]\])/g).map((part, index) => {
      const match = /^\[\[([^|]+)\|([^\]]+)\]\]$/.exec(part);
      const article = match && wiki.find((item) => item.slug === match[1] || item.title === match[1] || item.previousTitles?.includes(match[1]));
      return article ? (
        <a className="wikilink" key={index} href={'#/wiki/' + article.id}>
          {match![2]}
        </a>
      ) : (
        <Fragment key={index}>{match ? match[2] : part}</Fragment>
      );
    });
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  return lines.length > 0 && lines.every((line) => /^\d+\.\s/.test(line)) ? (
    <ol className="wiki-steps">
      {lines.map((line, index) => (
        <li key={index}>{inline(line.replace(/^\d+\.\s/, ''))}</li>
      ))}
    </ol>
  ) : (
    <>
      {lines.map((line, index) => (
        <p key={index}>{inline(line)}</p>
      ))}
    </>
  );
}
export function markdownHtml(markdown: string) {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
  const inline = (value: string) =>
    value
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  let html = '';
  let quote = false;
  let paragraph: string[] = [];
  function flushParagraph() {
    if (paragraph.length) html += '<p>' + inline(paragraph.join('<br>')) + '</p>';
    paragraph = [];
  }
  function closeQuote() {
    if (quote) html += '</blockquote>';
    quote = false;
  }
  for (const line of escape(markdown).split(/\r?\n/)) {
    if (/^#{1,3}\s/.test(line)) {
      flushParagraph();
      closeQuote();
      html += '<h2>' + inline(line.replace(/^#{1,3}\s+/, '')) + '</h2>';
    } else if (/^&gt;\s?/.test(line)) {
      flushParagraph();
      if (!quote) {
        html += '<blockquote>';
        quote = true;
      }
      html += inline(line.replace(/^&gt;\s?/, ''));
    } else if (!line.trim()) {
      flushParagraph();
      closeQuote();
    } else {
      closeQuote();
      paragraph.push(line);
    }
  }
  flushParagraph();
  closeQuote();
  return cleanHtml(html || '<p></p>');
}
export function htmlMarkdown(html: string) {
  const template = document.createElement('template');
  template.innerHTML = cleanHtml(html);
  function convert(node: ChildNode): string {
    if (node.nodeType === 3)
      return (node.textContent || '').replace(/([\\\x60*_{}\[\]<>])/g, '\\$1');
    if (!(node instanceof HTMLElement)) return '';
    const value = [...node.childNodes].map(convert).join('');
    switch (node.tagName) {
      case 'BR':
        return '\n';
      case 'STRONG':
      case 'B':
        return '**' + value + '**';
      case 'EM':
      case 'I':
        return '*' + value + '*';
      case 'U':
        return '<u>' + value + '</u>';
      case 'S':
      case 'DEL':
        return '~~' + value + '~~';
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return '\n' + '#'.repeat(Number(node.tagName[1])) + ' ' + value + '\n\n';
      case 'BLOCKQUOTE':
        return (
          '\n' +
          value
            .trim()
            .split('\n')
            .map((line) => '> ' + line)
            .join('\n') +
          '\n\n'
        );
      case 'A':
        return '[' + value + '](' + (node.getAttribute('href') || '#') + ')';
      case 'PRE': {
        const text = node.textContent || '';
        const fence = String.fromCharCode(96).repeat(
          Math.max(3, ...[...text.matchAll(/\x60+/g)].map((match) => match[0].length + 1)),
        );
        return '\n' + fence + '\n' + text + '\n' + fence + '\n\n';
      }
      case 'CODE': {
        const text = node.textContent || '';
        const fence = String.fromCharCode(96).repeat(
          Math.max(1, ...[...text.matchAll(/\x60+/g)].map((match) => match[0].length + 1)),
        );
        return fence + ' ' + text + ' ' + fence;
      }
      case 'UL':
      case 'OL':
        return (
          '\n' +
          [...node.children]
            .map((child, index) => {
              const lines = convert(child).trim().split('\n');
              const prefix = node.tagName === 'OL' ? index + 1 + '. ' : '- ';
              return prefix + lines.join('\n' + ' '.repeat(prefix.length));
            })
            .join('\n') +
          '\n\n'
        );
      case 'LI':
        return value;
      case 'TABLE': {
        const rows = [...node.querySelectorAll('tr')].map(
          (row) =>
            '| ' +
            [...row.children]
              .map((cell) => convert(cell).trim().replace(/\|/g, '\\|'))
              .join(' | ') +
            ' |',
        );
        if (rows.length)
          rows.splice(
            1,
            0,
            '| ' + [...node.querySelector('tr')!.children].map(() => '---').join(' | ') + ' |',
          );
        return '\n' + rows.join('\n') + '\n\n';
      }
      case 'HR':
        return '\n---\n\n';
      case 'P':
      case 'DIV':
        return value + '\n\n';
      default:
        return value;
    }
  }
  return [...template.content.childNodes].map(convert).join('').trim();
}
