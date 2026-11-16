import { it, expect } from 'vitest';
import { renderMobileMarkdown, renderMobileHtml } from '../src/modules/mobile/mobile-markdown.js';
it('renders native tables, steps, internal links and real PNG math without executing HTML', async () => {
  const r = await renderMobileMarkdown(
    '# 光学\n\n行内 $E=mc^2$\n\n$$\n\\frac{1}{f}=\\frac{1}{u}+\\frac{1}{v}\n$$\n\n|参数|值|\n|-|-|\n|距离|1|\n\n1. 准备\n2. 办理\n\n[[误差分析]]\n\n<script>alert(1)</script>',
  );
  const serialized = JSON.stringify(r);
  expect(serialized).toContain('data:image/png;base64,iVBOR');
  expect(serialized).toContain('table');
  expect(serialized).toContain('ol');
  expect(r.links[0]!.url).toMatch(/^wiki:/);
  expect(serialized).not.toContain('"name":"script"');
  await expect(renderMobileMarkdown('$\\require{html}$')).rejects.toThrow('FORMULA_UNSUPPORTED');
});

it('projects complete website rich posts without active HTML or unsafe links', () => {
  const r = renderMobileHtml(
    '<p>Full <strong>body</strong></p><script>secret()</script><img src="javascript:alert(1)" onerror="x()"><a href="https://example.org">source</a><table><tr><td>cell</td></tr></table>',
  );
  const json = JSON.stringify(r);
  expect(json).toContain('Full ');
  expect(json).toContain('strong');
  expect(json).not.toContain('secret()');
  expect(json).not.toContain('javascript:');
  expect(json).not.toContain('onerror');
  expect(r.links).toEqual([{ label: 'source', url: 'https://example.org' }]);
  expect(r.blocks.at(-1)?.wide).toBe(true);
});
