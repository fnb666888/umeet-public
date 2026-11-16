import { describe, it, expect, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {} }), usePathname: () => '/' }));
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeMarkdown } from '../src/components/knowledge/KnowledgeMarkdown';
describe('shared knowledge renderer', () => {
  it('renders formulas, manual steps, tables and stable global links', () => {
    const output = renderToStaticMarkup(
      <KnowledgeMarkdown
        markdown={
          '# 校园指南\n\n1. 阅读材料\n2. 提交申请\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$F=ma$\n\n[前置知识](/knowledge/stable-id)'
        }
      />,
    );
    expect(output).toContain('<ol>');
    expect(output).toContain('<table>');
    expect(output).toContain('class="katex"');
    expect(output).toContain('/knowledge/stable-id');
  });
  it('never renders scripts, raw event handlers or trusted math commands', () => {
    const output = renderToStaticMarkup(
      <KnowledgeMarkdown
        markdown={
          '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)\n\n$\\href{javascript:alert(1)}{点此}$'
        }
      />,
    );
    expect(output).not.toContain('<script');
    expect(output).not.toContain('onerror=');
    expect(output).not.toContain('href="javascript:');
  });
});
