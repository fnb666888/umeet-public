'use client';

import { useState } from 'react';
import type { DemoWiki } from '../../../../../packages/contracts/src/community';
import { boards } from '../community/model';

function fields(value: Partial<DemoWiki>) {
  return [
    ['标题', value.title],
    ['摘要', value.summary],
    [
      '社区',
      value.communities
        ?.map((slug) => boards.find((board) => board.slug === slug)?.name || slug)
        .join('、'),
    ],
    ['正文', value.sections?.map((section) => section.h + '\n' + section.p).join('\n\n')],
    ['速查信息', value.quick?.map(([label, content]) => label + ' — ' + content).join('\n')],
    [
      '表格',
      value.table
        ? [value.table.heads, ...value.table.rows].map((row) => row.join(' | ')).join('\n')
        : '',
    ],
    ['参考资料', value.reference],
  ].map(([label, content]) => ({
    label: String(label),
    text: content || '未填写',
  }));
}
export function WikiComparison({
  wiki,
  onRestore,
  manageable = true,
}: {
  wiki: DemoWiki;
  onRestore: (revision: number) => void;
  manageable?: boolean;
}) {
  const [revision, setRevision] = useState(Math.max(1, wiki.revisions - 1));
  const entry = wiki.history[wiki.revisions - revision];
  const previous = {
    communities: wiki.communities,
    ...((entry?.['after'] as Partial<DemoWiki>) || {}),
  };
  const currentFields = fields(wiki);
  const oldFields = fields(previous);
  return (
    <section className="admin-wiki-compare">
      <h3>版本比较</h3>
      <details className="admin-recent-changes">
        <summary>最近修改</summary>
        {wiki.history.slice(0, 20).map((entry, index) => (
          <article key={index}>
            <strong>
              v{wiki.revisions - index} · {String(entry['author'] || '已注销用户')}
            </strong>
            <p>{String(entry['reason'] || '更新词条')}</p>
            <small>{new Date(String(entry['at'])).toLocaleString('zh-CN')}</small>
          </article>
        ))}
      </details>
      <label>
        选择历史版本
        <select
          aria-label="选择 Wiki 历史版本"
          value={revision}
          onChange={(event) => setRevision(Number(event.target.value))}
        >
          {wiki.history.map((entry, index) => (
            <option key={index} value={wiki.revisions - index}>
              v{wiki.revisions - index} · {String(entry['reason'] || '修改')}
            </option>
          ))}
        </select>
      </label>
      <p>
        历史版本 v{revision} → 当前版本 v{wiki.revisions}
      </p>
      {entry &&
        currentFields.map((field, index) => (
          <details key={field.label} open={field.text !== oldFields[index]!.text}>
            <summary>
              {field.label}
              <span>{field.text === oldFields[index]!.text ? '无变化' : '有变化'}</span>
            </summary>
            <div className="admin-diff">
              <div>
                <h4>选定历史版本</h4>
                <DiffText text={oldFields[index]!.text} other={field.text} removed />
              </div>
              <div>
                <h4>当前版本</h4>
                <DiffText text={field.text} other={oldFields[index]!.text} />
              </div>
            </div>
          </details>
        ))}
      <button
        disabled={!manageable || !entry || revision === wiki.revisions}
        onClick={() => onRestore(revision)}
      >
        恢复到 v{revision}
      </button>
    </section>
  );
}

function DiffText({
  text,
  other,
  removed = false,
}: {
  text: string;
  other: string;
  removed?: boolean;
}) {
  const lines = text.split(String.fromCharCode(10));
  const old = other.split(String.fromCharCode(10));
  let prefix = 0;
  while (prefix < Math.min(lines.length, old.length) && lines[prefix] === old[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(lines.length, old.length) - prefix &&
    lines[lines.length - suffix - 1] === old[old.length - suffix - 1]
  )
    suffix++;
  return (
    <pre>
      {lines.map((line, index) => (
        <span
          key={index}
          className={
            index >= prefix && index < lines.length - suffix
              ? removed
                ? 'diff-removed'
                : 'diff-added'
              : ''
          }
        >
          {line || ' '}
          {String.fromCharCode(10)}
        </span>
      ))}
    </pre>
  );
}
