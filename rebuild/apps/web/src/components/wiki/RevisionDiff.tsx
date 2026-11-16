import type { RevisionDiff as Diff } from '../../../../../packages/contracts/src/index';
export function RevisionDiff({ value }: { value: Diff }) {
  return (
    <section className="panel revision-diff">
      <h2>版本差异</h2>
      <p className="muted">绿色为新增，红色为移除；相邻改动合并为文本块。</p>
      {value.blocks.map((block, index) => (
        <pre key={index} className={'diff-' + block.kind}>
          <span>
            {block.kind === 'added' ? '＋ 新增' : block.kind === 'removed' ? '− 移除' : '共同内容'}
          </span>
          <code>{block.text}</code>
        </pre>
      ))}
      <p className="muted">
        新增附件：{value.attachments.added.join('、') || '无'}；移除附件：
        {value.attachments.removed.join('、') || '无'}。
      </p>
    </section>
  );
}
