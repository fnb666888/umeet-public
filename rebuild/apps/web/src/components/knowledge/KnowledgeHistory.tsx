'use client';
import { useState } from 'react';
import type { KnowledgePage } from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge, useKnowledgeCapabilities } from './useKnowledge';
import { knowledge, failureMessage } from './knowledge-client';
import { KnowledgeStatus, formatTime } from './KnowledgeUI';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';
import type { RevisionDiff as Diff } from '../../../../../packages/contracts/src/index';
import { RevisionDiff } from '../wiki/RevisionDiff';
type Revision = {
  id: string;
  title: string;
  markdown: string;
  changeNote: string;
  createdAt: string;
};
type RevisionMeta = Omit<Revision, 'markdown'> & { authorAlias: string };
export function KnowledgeHistory({ page }: { page: KnowledgePage }) {
  const history = useKnowledge<RevisionMeta[]>('pages/' + page.id + '/history'),
    { cap } = useKnowledgeCapabilities();
  const [selected, setSelected] = useState<Revision | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [diff, setDiff] = useState<Diff | null>(null);
  return (
    <section>
      <h2>版本历史</h2>
      <KnowledgeStatus
        loading={history.loading}
        error={history.error || error}
        retry={history.reload}
      />
      <div className="knowledge-history-list">
        {history.data?.map((r) => (
          <button
            className="knowledge-history-item"
            key={r.id}
            onClick={async () => {
              setError('');
              try {
                setDiff(
                  await knowledge<Diff>(
                    'pages/' +
                      page.id +
                      '/diff?fromId=' +
                      encodeURIComponent(r.id) +
                      '&toId=' +
                      encodeURIComponent(page.revisionId),
                  ),
                );
                setSelected(
                  await knowledge<Revision>(
                    'pages/' + page.id + '/revision?revisionId=' + encodeURIComponent(r.id),
                  ),
                );
              } catch (e) {
                setError(failureMessage(e));
              }
            }}
          >
            <strong>{r.title}</strong>
            <span>{r.changeNote || '未填写修改说明'}</span>
            <small>
              {r.authorAlias}，{formatTime(r.createdAt)}
            </small>
            {r.id === page.revisionId && <span className="knowledge-badge">当前版本</span>}
          </button>
        ))}
      </div>
      {selected && (
        <div className="knowledge-history-preview">
          <h3>{selected.title}</h3>
          {diff && <RevisionDiff value={diff} />}
          <div className="knowledge-compare">
            <div>
              <h4>所选版本</h4>
              <pre>{selected.markdown}</pre>
            </div>
            <div>
              <h4>当前公开版本</h4>
              <pre>{page.markdown}</pre>
            </div>
          </div>
          <details>
            <summary>预览所选版本</summary>
            <KnowledgeMarkdown markdown={selected.markdown} />
          </details>
          {cap.canGovernBody && !page.paused && selected.id !== page.revisionId && (
            <button
              className="knowledge-button"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('将以所选内容发布一个新版本，现有历史会保留。继续回退？'))
                  return;
                setBusy(true);
                setError('');
                try {
                  await knowledge('pages/' + page.id + '/rollback', {
                    method: 'POST',
                    accountId: cap.accountId!,
                    body: {
                      revisionId: selected.id,
                      baseRevisionId: page.revisionId,
                      idempotencyKey: crypto.randomUUID(),
                    },
                  });
                  location.reload();
                } catch (e) {
                  setError(failureMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              以此版本内容发布回退修订
            </button>
          )}
        </div>
      )}
    </section>
  );
}
