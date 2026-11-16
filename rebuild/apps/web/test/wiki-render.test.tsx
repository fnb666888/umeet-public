import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {WikiArticle} from '../src/components/wiki/WikiArticle';
describe('public Wiki rendering',()=>{
 it('renders tables, formulas and community-scoped links',()=>{
  const output=renderToStaticMarkup(<WikiArticle communitySlug="resources" markdown={'| 概念 | 含义 |\n| --- | --- |\n| 熵 | 不确定性 |\n\n$H(X)$\n\n[[campus/library|图书馆]]'}/>);
  expect(output).toContain('<table>');expect(output).toContain('class="katex"');expect(output).toContain('href="/c/campus/wiki/library"');
 });
 it('never emits executable HTML, unsafe URLs or trusted math commands',()=>{
  const output=renderToStaticMarkup(<WikiArticle communitySlug="resources" markdown={'<script>alert(1)</script>\n\n[点击](javascript:alert%281%29)\n\n$\\href{javascript:alert(1)}{点此}$'}/>);
  expect(output).not.toContain('<script');expect(output).not.toContain('href="javascript:');expect(output).not.toContain('onerror=');
 });
});
