'use client';
import type { KnowledgeRelationInput } from '../../../../../packages/contracts/src/knowledge';
import { relationKinds, relationLabels } from '../../../../../packages/contracts/src/knowledge';
import { PagePicker, PageTitle } from './PagePicker';
export function RelationEditor({
  value,
  onChange,
  pageId,
}: {
  value: KnowledgeRelationInput[];
  onChange: (relations: KnowledgeRelationInput[]) => void;
  pageId?: string;
}) {
  function update(i: number, patch: Partial<KnowledgeRelationInput>) {
    onChange(value.map((r, index) => (index === i ? { ...r, ...patch } : r)));
  }
  return (
    <section className="knowledge-form-section">
      <h2>
        知识关系 <span className="knowledge-muted">按需添加</span>
      </h2>
      <p className="knowledge-help">关系与正文一起审核。普通引用链接无需再建关系。</p>
      {value.map((r, i) => (
        <div className="knowledge-relation-edit" key={r.targetPageId + ':' + i}>
          <div className="knowledge-row">
            <label>
              关系类型
              <select
                aria-label="关系类型"
                value={r.type}
                onChange={(e) =>
                  update(i, { type: e.target.value as KnowledgeRelationInput['type'] })
                }
              >
                {relationKinds.map((k) => (
                  <option key={k} value={k}>
                    {relationLabels[k]}
                  </option>
                ))}
              </select>
            </label>
            <strong>
              <PageTitle id={r.targetPageId} />
            </strong>
            <button
              className="knowledge-quiet"
              type="button"
              onClick={() => onChange(value.filter((_, n) => n !== i))}
            >
              移除
            </button>
          </div>
          <label>
            条件或适用范围
            <input
              value={r.conditions ?? ''}
              maxLength={2000}
              onChange={(e) => update(i, { conditions: e.target.value })}
              placeholder={r.type === 'approximation_of' ? '例如：忽略某项时成立的条件' : '可选'}
            />
          </label>
          <label>
            关系说明
            <textarea
              aria-label="关系说明"
              rows={2}
              value={r.explanation ?? ''}
              maxLength={2000}
              onChange={(e) => update(i, { explanation: e.target.value })}
            />
          </label>
          <label>
            依据或来源
            <input
              value={r.evidence ?? ''}
              maxLength={2000}
              onChange={(e) => update(i, { evidence: e.target.value })}
            />
          </label>
        </div>
      ))}
      <PagePicker
        label="添加关联词条"
        exclude={pageId ? [pageId] : []}
        onSelect={(p) => onChange([...value, { type: 'related', targetPageId: p.id }])}
      />
    </section>
  );
}
