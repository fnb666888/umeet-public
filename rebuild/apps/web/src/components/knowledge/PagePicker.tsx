'use client';
import { useState } from 'react';
import type { KnowledgePage } from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge } from './useKnowledge';
export function PagePicker({
  label,
  onSelect,
  exclude = [],
}: {
  label: string;
  onSelect: (page: KnowledgePage) => void;
  exclude?: string[];
}) {
  const [q, setQ] = useState(''),
    [open, setOpen] = useState(false);
  const resource = useKnowledge<{ items: KnowledgePage[] }>(
    'pages?q=' + encodeURIComponent(q) + '&limit=20',
  );
  return (
    <div className="knowledge-picker">
      <label>
        {label}
        <input
          value={q}
          placeholder="按名称搜索词条"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          maxLength={200}
        />
      </label>
      {open && (
        <div className="knowledge-picker-results">
          <button type="button" className="knowledge-quiet" onClick={() => setOpen(false)}>
            收起搜索结果
          </button>
          {resource.loading && <p role="status">正在搜索…</p>}
          {resource.error && <p role="alert">{resource.error}</p>}
          {resource.data?.items
            .filter((p) => !exclude.includes(p.id))
            .map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onSelect(p);
                  setQ('');
                  setOpen(false);
                }}
              >
                <strong>{p.title}</strong>
                <span>{p.summary}</span>
              </button>
            ))}
          {resource.data?.items.length === 0 && <p>没有匹配的已发布词条</p>}
        </div>
      )}
    </div>
  );
}
export function PageTitle({ id }: { id: string }) {
  const r = useKnowledge<KnowledgePage>('pages/' + id);
  return <>{r.data?.title ?? (r.loading ? '加载词条名称…' : '词条不可用')}</>;
}
