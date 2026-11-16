'use client';
import { useState } from 'react';
import type { KnowledgeCapabilities } from '../../../../../packages/contracts/src/knowledge';
import {
  KnowledgeDirectoryChangeSchema,
  KnowledgeRouteSchema,
} from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge } from './useKnowledge';
import { knowledge } from './knowledge-client';
import { KnowledgeActionDialog, type KnowledgeAction } from './KnowledgeActionDialog';
import { KnowledgeStatus } from './KnowledgeUI';
type Suggestion = { id: string; kind: string; state: string; reason: string; payload: string };
export function OrganizationReviewQueue({
  communityId,
  cap,
}: {
  communityId: string;
  cap: KnowledgeCapabilities;
}) {
  const r = useKnowledge<Suggestion[]>('communities/' + communityId + '/suggestions');
  const [action, setAction] = useState<KnowledgeAction | null>(null);
  function review(p: Suggestion, decision: 'approve' | 'return') {
    setAction({
      title: decision === 'approve' ? '批准组织调整' : '退回组织建议',
      description:
        '此操作只影响当前社区的目录或学习路线，共享词条正文不受影响。请核对建议与现有组织版本。',
      confirm: decision === 'approve' ? '批准调整' : '退回建议',
      run: async (reason) => {
        await knowledge('suggestions/' + p.id + '/review', {
          method: 'POST',
          accountId: cap.accountId!,
          body: { decision, reason },
        });
        r.reload();
      },
    });
  }
  return (
    <section>
      <h2>目录与路线建议</h2>
      <KnowledgeStatus loading={r.loading} error={r.error} retry={r.reload} />
      {r.data?.map((p) => (
        <details className="knowledge-proposal" key={p.id}>
          <summary>
            {p.kind === 'directory' ? '目录调整建议' : '学习路线建议'}
            <span>
              {
                { pending: '待审核', returned: '已退回', approved: '已批准' }[
                  p.state as 'pending' | 'returned' | 'approved'
                ]
              }
            </span>
          </summary>
          <div className="knowledge-proposal-body">
            <SuggestionContent suggestion={p} />
            {p.reason && <p>处理说明：{p.reason}</p>}
            {cap.canOrganizeCommunity && p.state === 'pending' && (
              <div className="knowledge-actions">
                <button className="knowledge-button" onClick={() => review(p, 'return')}>
                  退回补充
                </button>
                <button
                  className="knowledge-button knowledge-primary"
                  onClick={() => review(p, 'approve')}
                >
                  批准调整
                </button>
              </div>
            )}
          </div>
        </details>
      ))}
      {r.data?.length === 0 && <p className="knowledge-muted">当前社区没有建议记录。</p>}
      <KnowledgeActionDialog action={action} onClose={() => setAction(null)} />
    </section>
  );
}
function SuggestionContent({ suggestion: p }: { suggestion: Suggestion }) {
  const value: unknown = JSON.parse(p.payload);
  if (p.kind === 'directory') {
    const d = KnowledgeDirectoryChangeSchema.safeParse(value);
    return d.success ? (
      <>
        <h3>建议目录结构</h3>
        <ul>
          {d.data.nodes.map((n) => (
            <li key={n.id}>{n.title}</li>
          ))}
        </ul>
        <p>
          收录 {d.data.collections.length} 篇词条，安排 {d.data.entries.length} 处目录引用。
        </p>
      </>
    ) : (
      <p>建议内容格式有误，请退回作者。</p>
    );
  }
  const r = KnowledgeRouteSchema.safeParse(value);
  return r.success ? (
    <>
      <h3>{r.data.title}</h3>
      <p>{r.data.goal}</p>
      <ol>
        {r.data.steps.map((s) => (
          <li key={s.id}>
            {s.goal}
            <p>{s.intro}</p>
          </li>
        ))}
      </ol>
    </>
  ) : (
    <p>建议内容格式有误，请退回作者。</p>
  );
}
