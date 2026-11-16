'use client';
import { SiteLink as Link } from '../SiteLink';
import { useState } from 'react';
import type {
  KnowledgeRoute,
  KnowledgePage,
} from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge, useKnowledgeCapabilities } from './useKnowledge';
import { knowledge, failureMessage } from './knowledge-client';
import { KnowledgeHeader, KnowledgeStatus } from './KnowledgeUI';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';
import { RouteEditor } from './RouteEditor';
export function LearningRoute({ routeId }: { routeId: string }) {
  const r = useKnowledge<KnowledgeRoute>('routes/' + routeId),
    { cap } = useKnowledgeCapabilities(r.data?.communityId);
  const [index, setIndex] = useState(0),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const route = r.data,
    step = route?.steps[index];
  return (
    <div className="knowledge">
      <KnowledgeStatus loading={r.loading} error={r.error} retry={r.reload} />
      {route && (
        <>
          <KnowledgeHeader title={route.title} description={route.goal}>
            {cap.canContribute && (
              <button className="knowledge-button" onClick={() => setEditing(true)}>
                {cap.canOrganizeCommunity ? '维护学习路线' : '建议调整路线'}
              </button>
            )}
          </KnowledgeHeader>
          {message && (
            <p className="knowledge-notice" role="status">
              {message}
            </p>
          )}
          {editing ? (
            <RouteEditor
              communityId={route.communityId}
              cap={cap}
              route={route}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                setMessage(cap.canOrganizeCommunity ? '学习路线已保存' : '路线建议已提交审核。');
                r.reload();
              }}
            />
          ) : (
            <div className="knowledge-route-reading">
              <aside>
                <h2>阅读顺序</h2>
                <ol>
                  {route.steps.map((s, i) => (
                    <li key={s.id}>
                      <button
                        onClick={() => setIndex(i)}
                        aria-current={i === index ? 'step' : undefined}
                      >
                        <span>{i + 1}</span>
                        <div>
                          {s.title}
                          {s.needsReview && <small>内容已更新，导读待复核</small>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ol>
              </aside>
              <section>
                {step && (
                  <>
                    <div className="knowledge-route-intro">
                      <p className="knowledge-muted">
                        第 {index + 1} 步，共 {route.steps.length} 步
                      </p>
                      <h2>{step.title}</h2>
                      {step.goal && (
                        <p>
                          <strong>本步目标：</strong>
                          {step.goal}
                        </p>
                      )}
                      {step.intro && <p>{step.intro}</p>}
                      {step.needsReview && (
                        <div className="knowledge-notice">
                          {step.available
                            ? '词条已更新，路线导读待维护者复核。正文展示最新发布版。'
                            : '词条当前不可用。可继续其他步骤，或反馈给维护者。'}
                          {cap.canOrganizeCommunity && step.available && (
                            <button
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                setError('');
                                try {
                                  await knowledge('routes/' + routeId + '/confirm', {
                                    method: 'POST',
                                    accountId: cap.accountId!,
                                    body: { stepId: step.id, revisionId: step.revisionId },
                                  });
                                  r.reload();
                                } catch (e) {
                                  setError(failureMessage(e));
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              已核对本步导读与最新正文
                            </button>
                          )}
                        </div>
                      )}
                      {error && <p role="alert">{error}</p>}
                    </div>
                    {step.available && (
                      <RouteBody key={step.pageId + step.revisionId} pageId={step.pageId} />
                    )}
                    <div className="knowledge-route-navigation">
                      <button
                        className="knowledge-button"
                        disabled={index === 0}
                        onClick={() => setIndex((i) => i - 1)}
                      >
                        上一步
                      </button>
                      {step.available && (
                        <Link href={'/knowledge/' + step.pageId}>查看词条、关系与讨论</Link>
                      )}
                      <button
                        className="knowledge-button knowledge-primary"
                        disabled={index === route.steps.length - 1}
                        onClick={() => setIndex((i) => i + 1)}
                      >
                        下一步
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function RouteBody({ pageId }: { pageId: string }) {
  const r = useKnowledge<KnowledgePage>('pages/' + pageId);
  return (
    <>
      <KnowledgeStatus loading={r.loading} error={r.error} retry={r.reload} />
      {r.data && <KnowledgeMarkdown markdown={r.data.markdown} />}
    </>
  );
}
