'use client';
import { SiteLink as Link } from '../SiteLink';
import { useState } from 'react';
import type {
  KnowledgeProposal,
  KnowledgePage,
  KnowledgeCapabilities,
} from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge } from './useKnowledge';
import { knowledge } from './knowledge-client';
import { KnowledgeActionDialog, type KnowledgeAction } from './KnowledgeActionDialog';
import { formatTime } from './KnowledgeUI';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';
import { PageTitle } from './PagePicker';
export function KnowledgeReviewQueue({
  proposals,
  cap,
  onChanged,
}: {
  proposals: KnowledgeProposal[];
  cap: KnowledgeCapabilities;
  onChanged: () => void;
}) {
  const [action, setAction] = useState<KnowledgeAction | null>(null);
  return (
    <>
      <div className="knowledge-review-list">
        {proposals.map((p) => (
          <Proposal
            key={p.id + ':' + p.version}
            proposal={p}
            cap={cap}
            setAction={setAction}
            onChanged={onChanged}
          />
        ))}
        {!proposals.length && <p className="knowledge-muted">还没有提交记录。</p>}
      </div>
      <KnowledgeActionDialog action={action} onClose={() => setAction(null)} />
    </>
  );
}
function Proposal({
  proposal: p,
  cap,
  setAction,
  onChanged,
}: {
  proposal: KnowledgeProposal;
  cap: KnowledgeCapabilities;
  setAction: (a: KnowledgeAction) => void;
  onChanged: () => void;
}) {
  const current = useKnowledge<KnowledgePage>('pages/' + p.pageId);
  const stale = !!current.data && current.data.revisionId !== p.content.baseRevisionId;
  function review(decision: 'approve' | 'return') {
    setAction({
      title:
        decision === 'approve'
          ? current.data?.paused
            ? '复核并发布修改'
            : '批准这份修改'
          : '退回补充',
      description:
        decision === 'approve'
          ? '请核对正文、知识关系、适用条件与依据。批准后将更新公开版本并保留贡献者记录。'
          : '请写清需要补充或修正的内容，作者可修改后重新提交。',
      confirm: decision === 'approve' ? '确认批准发布' : '退回作者',
      run: async (reason) => {
        await knowledge('proposals/' + p.id + '/review', {
          method: 'POST',
          accountId: cap.accountId!,
          body: {
            decision,
            reason,
            expectedPublishedRevisionId: current.data?.revisionId ?? null,
            idempotencyKey: crypto.randomUUID(),
          },
        });
        onChanged();
      },
    });
  }
  return (
    <details className="knowledge-proposal">
      <summary>
        <div>
          <strong>{p.content.title}</strong>
          <span>{formatTime(p.createdAt)}</span>
        </div>
        <span className={'knowledge-badge ' + (p.state === 'returned' ? 'knowledge-warning' : '')}>
          {{ pending: '待审核', returned: '已退回', approved: '已批准' }[p.state]}
        </span>
      </summary>
      <div className="knowledge-proposal-body">
        {p.reason && <p className="knowledge-notice">处理说明：{p.reason}</p>}
        <p>修改说明：{p.content.changeNote || '未填写'}</p>
        {stale && (
          <p className="knowledge-notice">
            公开正文已有更新。请进入编辑页对照最新版本合并，不能直接批准旧稿覆盖新版本。
          </p>
        )}
        <div className="knowledge-compare">
          <section>
            <h3>提交的修改</h3>
            <h4>{p.content.title}</h4>
            <p>{p.content.summary}</p>
            <KnowledgeMarkdown markdown={p.content.markdown} />
          </section>
          <section>
            <h3>当前公开正文</h3>
            {current.data && (
              <>
                <h4>{current.data.title}</h4>
                <p>{current.data.summary}</p>
              </>
            )}
            {current.data ? (
              <KnowledgeMarkdown markdown={current.data.markdown} />
            ) : (
              <p className="knowledge-muted">尚无可公开读取的正文</p>
            )}
          </section>
        </div>
        <section>
          <h3>此次提交的知识关系</h3>
          {p.content.relations.map((r, i) => (
            <p key={i}>
              {
                {
                  prerequisite: '前置知识',
                  approximation_of: '近似自',
                  applied_to: '应用于',
                  related: '相关知识',
                }[r.type]
              }
              ：<PageTitle id={r.targetPageId} />
              。条件：{r.conditions || '未填写条件'}；{r.explanation}；依据：{r.evidence}
            </p>
          ))}
          {!p.content.relations.length && <p>无结构化关系</p>}
          {current.data && (
            <details>
              <summary>对照当前已发布的关系</summary>
              {current.data.relations.map((r, i) => (
                <p key={i}>
                  {
                    {
                      prerequisite: '前置知识',
                      approximation_of: '近似自',
                      applied_to: '应用于',
                      related: '相关知识',
                    }[r.type]
                  }
                  ：<PageTitle id={r.targetPageId} />
                  。条件：{r.conditions || '未填写条件'}；说明：{r.explanation}；依据：{r.evidence}
                </p>
              ))}
              {!current.data.relations.length && <p>无结构化关系</p>}
            </details>
          )}
        </section>
        <div className="knowledge-actions">
          {p.state !== 'approved' && (
            <Link
              className="knowledge-button"
              href={'/knowledge/' + p.pageId + '/edit?proposal=' + p.id}
            >
              {stale ? '对照最新版本合并' : '补充并重新提交'}
            </Link>
          )}
          {cap.canGovernBody && p.state === 'pending' && (
            <>
              <button className="knowledge-button" onClick={() => review('return')}>
                退回补充
              </button>
              <button
                className="knowledge-button knowledge-primary"
                disabled={stale || (!!current.data?.paused && !cap.isSiteAdmin)}
                onClick={() => review('approve')}
              >
                {current.data?.paused ? '复核并发布' : '批准发布'}
              </button>
            </>
          )}
        </div>
      </div>
    </details>
  );
}
