'use client';
import type { KnowledgeRelationInput } from '../../../../../packages/contracts/src/knowledge';
import { relationLabels } from '../../../../../packages/contracts/src/knowledge';
import { PageTitle } from './PagePicker';
export function RelationSnapshot({ relations }: { relations: KnowledgeRelationInput[] }) {
  return (
    <div>
      {relations.map((r, i) => (
        <div className="knowledge-relation" key={i}>
          <span className="knowledge-badge">{relationLabels[r.type]}</span>{' '}
          <PageTitle id={r.targetPageId} />
          {r.conditions && <p>条件：{r.conditions}</p>}
          {r.explanation && <p>说明：{r.explanation}</p>}
          {r.evidence && <p>依据：{r.evidence}</p>}
        </div>
      ))}
      {!relations.length && <p className="knowledge-muted">无结构化关系</p>}
    </div>
  );
}
