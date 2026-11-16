import { SaxesParser } from 'saxes';

// Consume only feed metadata. Never fetch article bodies or expand XML entities.
export function parseFeed(xml: string): { items: Record<string, string>[] } {
  if (Buffer.byteLength(xml) > 1_000_000 || /<!\s*(DOCTYPE|ENTITY)/i.test(xml))
    throw new Error('SOURCE_XML_UNSAFE');
  const parser = new SaxesParser({ xmlns: false });
  const stack: { name: string; text: string }[] = [],
    items: Record<string, string>[] = [];
  let item: Record<string, string> | null = null;
  parser.on('doctype', () => {
    throw new Error('SOURCE_XML_UNSAFE');
  });
  parser.on('opentag', (tag) => {
    const parent = stack.at(-1)?.name;
    stack.push({ name: tag.name.toLowerCase(), text: '' });
    if (stack.length > 40) throw new Error('SOURCE_XML_DEPTH');
    if (['item', 'entry'].includes(tag.name.toLowerCase())) item = {};
    if (
      item &&
      (parent === 'item' || parent === 'entry') &&
      tag.name === 'link' &&
      (!tag.attributes['rel'] || tag.attributes['rel'] === 'alternate')
    ) {
      if (typeof tag.attributes['href'] === 'string') item['url'] = tag.attributes['href'];
    }
  });
  parser.on('text', (value) => {
    const current = stack.at(-1);
    if (current) current.text += value;
  });
  parser.on('cdata', (value) => {
    const current = stack.at(-1);
    if (current) current.text += value;
  });
  parser.on('closetag', () => {
    const closed = stack.pop();
    if (!closed) return;
    const { name, text } = closed;
    const parent = stack.at(-1);
    if (parent) parent.text += text;
    if (!item) return;
    const fields: Record<string, string> = {
      title: 'title',
      link: 'url',
      guid: 'id',
      id: 'id',
      pubdate: 'date_published',
      published: 'date_published',
      updated: 'date_published',
      description: 'summary',
      summary: 'summary',
    };
    const key = parent && ['item', 'entry'].includes(parent.name) ? fields[name] : undefined;
    if (key && text.trim() && !item[key]) item[key] = text.trim();
    if (name === 'item' || name === 'entry') {
      if (items.length < 50) items.push({ ...item, id: item['id'] || item['url'] || '' });
      item = null;
    }
  });
  parser.write(xml).close();
  return { items };
}
