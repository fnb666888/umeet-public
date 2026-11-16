// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useSearchParams:()=>new URLSearchParams(),useRouter: () => ({ push() {} }), usePathname: () => '/' }));
import { CommunityApplication } from '../src/components/community/Application';
import {
  RichText,
  WikiText,
  htmlMarkdown,
  markdownHtml,
} from '../src/components/community/content';
import { cleanHtml, parseRoute, type Wiki } from '../src/components/community/model';
import { postMarkdownHtml } from '../src/components/community/markdown';

describe('React community migration', () => {
  it('renders source Markdown for preview with safe code, tables and inline formatting', () => {
    const source = [
      '## 标题',
      '',
      '**粗体** ~~删除~~ <u>下划线</u>',
      '',
      '- 第一项',
      '- 第二项',
      '',
      '| 项目 | 内容 |',
      '| --- | --- |',
      '| 测试 | 通过 |',
      '',
      '```js',
      'const value = "<script>raw()</script>";',
      '```',
    ].join('\n');
    const html = postMarkdownHtml(source);
    expect(html).toContain('<h2>标题</h2>');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<del>删除</del>');
    expect(html).toContain('<u>下划线</u>');
    expect(html).toContain('<ul><li>');
    expect(html).toContain('<table>');
    expect(html).toContain('&lt;script&gt;raw()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(postMarkdownHtml('[危险](javascript:alert)')).not.toContain('href=');
    expect(postMarkdownHtml('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });
  it('recovers existing rich drafts without losing underline, nested lists or code', () => {
    const original =
      '<h3>旧草稿</h3><p><u>下划线</u> <del>删除</del> <code>**源码**</code></p><ul><li>第一项<ul><li>子项</li></ul></li></ul><pre><code>&lt;p&gt;代码&lt;/p&gt;</code></pre>';
    const source = htmlMarkdown(original);
    const restored = postMarkdownHtml(source);
    expect(restored).toContain('<h3>旧草稿</h3>');
    expect(restored).toContain('<u>下划线</u>');
    expect(restored).toContain('<del>删除</del>');
    expect(restored).toContain('<code>**源码**</code>');
    expect(restored.match(/<ul>/g)).toHaveLength(2);
    expect(restored).toContain('&lt;p&gt;代码&lt;/p&gt;');
  });
  it('prerenders the React shell without the imperative Demo runtime', () => {
    const html = renderToStaticMarkup(<CommunityApplication />);
    expect(html).toContain('正在加载社区');
    expect(html).toContain('umeet-auth-dialog');
    expect(html).not.toContain('/demo/js/');
  });
  it('preserves hash links, query scope and nested reply anchors', () => {
    const route = parseRoute('#/posts/p1?thread=c1#cm-c2');
    expect(route.parts).toEqual(['posts', 'p1']);
    expect(route.params.get('thread')).toBe('c1');
    expect(route.anchor).toBe('cm-c2');
    expect(parseRoute('#/tag/%E6%A0%A1%E5%9B%AD').parts[1]).toBe('校园');
    expect(parseRoute('#/tag/%invalid').parts[1]).toBe('%invalid');
  });
  it('renders safe rich text as React nodes and strips executable content', () => {
    const html = renderToStaticMarkup(
      <RichText
        html={
          '<p onclick="bad()"><b>正文</b><a href="javascript:bad()">链接</a><img src=x onerror=bad()></p><script>bad()</script>'
        }
      />,
    );
    expect(html).toContain('<strong>正文</strong>');
    expect(html).not.toMatch(/onclick|onerror|javascript:|<script|<img/);
    expect(cleanHtml('<a href="https://example.com">来源</a>')).toContain('https://example.com');
  });
  it('preserves Markdown headings, strike-through and tables while stripping unsafe attributes', () => {
    const html = renderToStaticMarkup(
      <RichText
        html={
          '<h1>标题</h1><p><u>下划线</u><del onclick="bad()">删除</del></p><hr><table><tbody><tr><th>项目</th><td>内容</td></tr></tbody></table>'
        }
      />,
    );
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<u>下划线</u><s>删除</s>');
    expect(html).toContain('<table><tbody><tr><th>项目</th><td>内容</td></tr></tbody></table>');
    expect(html).not.toContain('onclick');
  });
  it('keeps Markdown formatting and wiki links through component rendering', () => {
    const html = markdownHtml('## 标题\n**加粗** 与 [来源](https://example.com)');
    expect(html).toContain('<h2>标题</h2>');
    expect(htmlMarkdown(html)).toContain('**加粗**');
    expect(markdownHtml('第一行\n第二行')).toBe('<p>第一行<br>第二行</p>');
    expect(markdownHtml('> 引用')).toBe('<blockquote>引用</blockquote>');
    const wiki = [{ id: 'w1', slug: 'library' }] as Wiki[];
    const rendered = renderToStaticMarkup(
      <WikiText text={'1. 查阅 [[library|图书馆]]\n2. 到场确认'} wiki={wiki} />,
    );
    expect(rendered).toContain('wiki-steps');
    expect(rendered).toContain('href="#/wiki/w1"');
  });
});
