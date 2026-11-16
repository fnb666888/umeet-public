// @vitest-environment jsdom
// Real editor tests are deliberately separate from the shared parser tests.
import { describe, it, expect } from 'vitest';
import { convertThroughEditor, normalizeMarkdown } from './adapter.js';
const source = `## 为什么需要隔离\n\n**示例**与[来源](https://example.com)。\n\n![说明](https://example.com/image.png)\n\n| 名称 | 含义 |\n| --- | --- |\n| 环境 | 隔离 |\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\n$$\nP(A)=0.5\n$$\n\n[[依赖管理]]\n\n- 第一条\n- 第二条\n`;
describe('real Milkdown Markdown round trip', () => {
  it('actually exercises distinct Markdown structures rather than escaped newline text',()=>{
    const types=new Set<string>();
    function visit(value:unknown){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object'){if('type'in value&&typeof value.type==='string')types.add(value.type);Object.values(value).forEach(visit);}}
    visit(normalizeMarkdown(source));
    expect([...types]).toEqual(expect.arrayContaining(['heading','image','table','code','math','list','link','strong']));
  });
  it('preserves the semantics of the supported cross-client fixture', async () => {
    const after = await convertThroughEditor(source);
    expect(normalizeMarkdown(after)).toEqual(normalizeMarkdown(source));
  });
  it('rejects unsafe raw HTML instead of silently dropping it', async () => {
    await expect(convertThroughEditor('<script>alert(1)</script>')).rejects.toThrow('UNSUPPORTED_HTML');
  });
});
