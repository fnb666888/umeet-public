'use client';
import { useState } from 'react';
import type { WikiRevisionDto } from '../../../../../packages/contracts/src/index';
export function ConflictResolver({
  latest,
  mine,
  mineTitle,
  onResolve,
}: {
  latest: WikiRevisionDto;
  mine: string;
  mineTitle: string;
  onResolve: (title: string, markdown: string, baseId: string) => void;
}) {
  const [merged, setMerged] = useState(mine);
  const [title, setTitle] = useState(mineTitle);
  return (
    <section className="conflict-panel" aria-label="合并版本冲突">
      <h2>有人先更新了这个词条</h2>
      <p>你的修改仍在。请对照最新版合并，继续保存时仍会检查版本。</p>
      <div className="conflict-columns">
        <label>
          当前公开标题
          <input aria-label="当前公开标题" readOnly value={latest.title} />
        </label>
        <label>
          合并后的标题
          <input
            aria-label="合并后的标题"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
          />
        </label>
      </div>
      <div className="conflict-columns">
        <label>
          当前公开版本
          <textarea aria-label="当前公开版本" readOnly value={latest.markdown} />
        </label>
        <label>
          合并后的正文
          <textarea
            aria-label="合并后的正文"
            value={merged}
            onChange={(e) => setMerged(e.target.value)}
          />
        </label>
      </div>
      <button type="button" className="primary" onClick={() => onResolve(title, merged, latest.id)}>
        使用合并结果继续编辑
      </button>
    </section>
  );
}
