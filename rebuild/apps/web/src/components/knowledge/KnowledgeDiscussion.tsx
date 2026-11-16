'use client';
import { useState } from 'react';
import type { KnowledgeDiscussion as Discussion } from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge, useKnowledgeCapabilities } from './useKnowledge';
import { knowledge, failureMessage } from './knowledge-client';
import { KnowledgeStatus, LoginNotice, formatTime } from './KnowledgeUI';
export function KnowledgeDiscussion({ pageId }: { pageId: string }) {
  const r = useKnowledge<Discussion[]>('pages/' + pageId + '/discussions'),
    { cap } = useKnowledgeCapabilities();
  const [body, setBody] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <section className="knowledge-discussion">
      <h2>讨论与纠错</h2>
      <p className="knowledge-help">指出问题时请附上依据。正文修改请使用“完善词条”提交审核。</p>
      <KnowledgeStatus loading={r.loading} error={r.error} retry={r.reload} />
      {r.data?.map((d) => (
        <div className="knowledge-comment" key={d.id}>
          <div>
            <strong>{d.authorAlias}</strong>
            <time>{formatTime(d.createdAt)}</time>
          </div>
          <p>{d.body}</p>
        </div>
      ))}
      {r.data?.length === 0 && (
        <p className="knowledge-muted">还没有讨论。可以补充来源，或指出需要修正的地方。</p>
      )}
      {cap.canContribute ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await knowledge('pages/' + pageId + '/discussions', {
                method: 'POST',
                accountId: cap.accountId!,
                body: { body },
              });
              setBody('');
              r.reload();
            } catch (e) {
              setError(failureMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            补充讨论或纠错
            <textarea
              aria-label="补充讨论或纠错"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={8000}
              rows={3}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="knowledge-button" disabled={busy}>
            {busy ? '正在发送…' : '发布讨论'}
          </button>
        </form>
      ) : (
        <LoginNotice />
      )}
    </section>
  );
}
