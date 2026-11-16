'use client';
import type {
  KnowledgeContent,
  KnowledgePage,
} from '../../../../../packages/contracts/src/knowledge';
import { RelationSnapshot } from './RelationSnapshot';
export function KnowledgeConflict({
  mine,
  latest,
  onConfirm,
}: {
  mine: KnowledgeContent;
  latest: KnowledgePage;
  onConfirm: () => void;
}) {
  return (
    <section className="knowledge-conflict" role="alert">
      <h2>词条已有新版本</h2>
      <p>当前稿件已保留。对照最新版本，将需要保留的修改合并到编辑区，再确认新的发布基准。</p>
      <div className="knowledge-compare">
        <div>
          <h3>当前稿件</h3>
          <strong>{mine.title}</strong>
          <pre>{mine.markdown}</pre>
          <RelationSnapshot relations={mine.relations} />
        </div>
        <div>
          <h3>最新已发布版本</h3>
          <strong>{latest.title}</strong>
          <pre>{latest.markdown}</pre>
          <RelationSnapshot relations={latest.relations} />
        </div>
      </div>
      <button type="button" className="knowledge-button" onClick={onConfirm}>
        已核对差异，以最新版本为基准继续编辑
      </button>
    </section>
  );
}
