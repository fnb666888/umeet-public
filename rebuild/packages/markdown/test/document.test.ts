import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../src/parse.js';
import { validateDocument } from '../src/schema.js';
import { extractWikiLinks, extractAttachments } from '../src/links.js';
import { serializeMarkdown } from '../src/serialize.js';
import { normalizeMarkdown } from '../src/normalize.js';
describe('shared Markdown safety and scoped references', () => {
  it('round-trips the semantic document through the canonical serializer', () => {
    const source =
      '# 熵\n\n**加粗** ![图](/media/image)\n\n| 概念 | 含义 |\n| --- | --- |\n| 熵 | 不确定性 |\n\n```ts\nconst entropy = 1;\n```\n\n$$\nH(X)\n$$\n\n[[信息熵]]';
    expect(normalizeMarkdown(serializeMarkdown(parseMarkdown(source)))).toEqual(
      normalizeMarkdown(source),
    );
  });
  it('accepts supported structures, but rejects HTML and executable URLs even when obfuscated', () => {
    expect(
      validateDocument(
        parseMarkdown('# 熵\n\n| 一 | 二 |\n| --- | --- |\n| 值 | 值 |\n\n$$x^2$$\n\n[[信息熵]]'),
      ).valid,
    ).toBe(true);
    for (const markdown of [
      '<img src=x onerror=alert(1)>',
      '[点此](javascript:alert%281%29)',
      '![图](data:image/svg+xml,evil)',
      '[点此](jav&#x61;script:evil)',
      '<script>alert(1)</script>',
    ])
      expect(validateDocument(parseMarkdown(markdown)).valid, markdown).toBe(false);
  });
  it('extracts scoped wiki links only from prose, excluding code, math and external link labels', () => {
    const ast = parseMarkdown(
      '[[信息熵]] 和 [[campus/图书馆|图书馆攻略]]\n\n`[[不是引用]]`\n\n```txt\n[[代码]]\n```\n\n[普通链接 [[标签]]](https://example.com)\n\n$$[[公式]]$$',
    );
    expect(extractWikiLinks(ast, 'resources')).toEqual([
      { communitySlug: 'resources', slug: '信息熵', label: '信息熵' },
      { communitySlug: 'campus', slug: '图书馆', label: '图书馆攻略' },
    ]);
  });
  it('finds image and downloadable attachments without executing or fetching them', () => {
    expect(
      extractAttachments(
        parseMarkdown('![图](/media/abc)\n\n[课件](/media/pdf-one)\n\n[参考](https://example.com)'),
      ),
    ).toEqual(['/media/abc', '/media/pdf-one']);
  });
});
