'use client';
import { SiteLink as Link } from '../SiteLink';
import { useState } from 'react';
import { Pencil, History, MessageSquare, Link as LinkIcon } from 'lucide-react';
import type {
  KnowledgePage,
  KnowledgeRelationInput,
} from '../../../../../packages/contracts/src/knowledge';
import { relationLabels } from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge, useKnowledgeCapabilities } from './useKnowledge';
import { KnowledgeHeader, KnowledgeStatus, formatTime, LoginNotice } from './KnowledgeUI';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';
import { KnowledgeDiscussion } from './KnowledgeDiscussion';
import { KnowledgeHistory } from './KnowledgeHistory';
import { PageTitle } from './PagePicker';
import { knowledgeHeadings } from './knowledge-headings';
type Relations = {
  outgoing: (KnowledgeRelationInput & { available: boolean })[];
  incoming: { sourcePageId: string; relation: KnowledgeRelationInput }[];
};
export function KnowledgeArticle({ pageId }: { pageId: string }) {
  const page = useKnowledge<KnowledgePage>('pages/' + pageId),
    relations = useKnowledge<Relations>('pages/' + pageId + '/relations'),
    backlinks = useKnowledge<{ pageId: string; title: string }[]>('pages/' + pageId + '/backlinks'),
    { cap } = useKnowledgeCapabilities();
  const [tab, setTab] = useState<'article' | 'history' | 'discussion'>('article'),
    [copied, setCopied] = useState(false);
  const p = page.data;
  return (
    <div className="knowledge">
      <KnowledgeStatus loading={page.loading} error={page.error} retry={page.reload} />
      {p && (
        <>
          <KnowledgeHeader title={p.title} description={p.summary}>
            {cap.canContribute ? (
              <Link
                className="knowledge-button knowledge-primary"
                href={'/knowledge/' + p.id + '/edit'}
              >
                <Pencil size={16} />
                完善词条
              </Link>
            ) : (
              <button
                className="knowledge-button"
                onClick={() => window.dispatchEvent(new Event('umeet:login'))}
              >
                登录后完善词条
              </button>
            )}
          </KnowledgeHeader>
          <div className="knowledge-article-meta">
            <span>最后编辑 {formatTime(p.createdAt)}</span>
            <span>{p.authorAlias}</span>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(location.origin + '/knowledge/' + p.id);
                  setCopied(true);
                } catch {
                  setCopied(false);
                  window.prompt('复制词条链接', location.origin + '/knowledge/' + p.id);
                }
              }}
            >
              <LinkIcon size={14} />
              {copied ? '链接已复制' : '复制词条链接'}
            </button>
          </div>
          {p.paused && (
            <div className="knowledge-notice">
              这篇词条正在争议复核。当前展示已发布版本，仍欢迎提交修改建议。
            </div>
          )}
          <div className="knowledge-tabs" role="tablist" aria-label="词条视图">
            <button role="tab" aria-selected={tab === 'article'} onClick={() => setTab('article')}>
              正文
            </button>
            <button
              role="tab"
              aria-selected={tab === 'discussion'}
              onClick={() => setTab('discussion')}
            >
              <MessageSquare size={16} />
              讨论与纠错
            </button>
            <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
              <History size={16} />
              版本历史
            </button>
          </div>
          {tab === 'article' ? (
            <div className="knowledge-reading">
              <article>
                <KnowledgeMarkdown markdown={p.markdown} />
                <section className="knowledge-relations">
                  <h2>知识关系</h2>
                  <KnowledgeStatus
                    loading={relations.loading}
                    error={relations.error}
                    retry={relations.reload}
                  />
                  {relations.data?.outgoing.map((r) => (
                    <div className="knowledge-relation" key={r.type + r.targetPageId}>
                      <span className="knowledge-badge">{relationLabels[r.type]}</span>
                      {r.available ? (
                        <Link href={'/knowledge/' + r.targetPageId}>
                          <PageTitle id={r.targetPageId} />
                        </Link>
                      ) : (
                        <span>关联词条不可用</span>
                      )}
                      {r.conditions && (
                        <p>
                          <strong>条件：</strong>
                          {r.conditions}
                        </p>
                      )}
                      {r.explanation && <p>{r.explanation}</p>}
                      {r.evidence && <p className="knowledge-muted">依据：{r.evidence}</p>}
                    </div>
                  ))}
                  {relations.data?.incoming
                    .filter(
                      (r) =>
                        r.relation.type !== 'related' ||
                        !relations.data?.outgoing.some(
                          (o) => o.type === 'related' && o.targetPageId === r.sourcePageId,
                        ),
                    )
                    .map((r) => (
                      <div className="knowledge-relation" key={r.relation.type + r.sourcePageId}>
                        <span className="knowledge-badge">
                          {
                            {
                              prerequisite: '后续知识',
                              approximation_of: '近似理论',
                              applied_to: '采用的理论',
                              related: '相关知识',
                            }[r.relation.type]
                          }
                        </span>
                        <Link href={'/knowledge/' + r.sourcePageId}>
                          <PageTitle id={r.sourcePageId} />
                        </Link>
                        {r.relation.conditions && <p>条件：{r.relation.conditions}</p>}
                      </div>
                    ))}
                  {relations.data &&
                    !relations.data.outgoing.length &&
                    !relations.data.incoming.length && (
                      <p className="knowledge-muted">还没有结构化关系，可在完善词条时按需添加。</p>
                    )}
                </section>
                <section className="knowledge-relations">
                  <h2>引用此词条的正文</h2>
                  <KnowledgeStatus
                    loading={backlinks.loading}
                    error={backlinks.error}
                    retry={backlinks.reload}
                  />
                  {backlinks.data?.map((link) => (
                    <p key={link.pageId}>
                      <Link href={'/knowledge/' + link.pageId}>{link.title}</Link>
                    </p>
                  ))}
                  {backlinks.data?.length === 0 && (
                    <p className="knowledge-muted">暂时没有其他已发布词条引用此正文。</p>
                  )}
                </section>
              </article>
              <aside className="knowledge-reading-aside">
                {knowledgeHeadings(p.markdown).length > 0 && (
                  <>
                    <h2>本页目录</h2>
                    <nav aria-label="正文目录">
                      {knowledgeHeadings(p.markdown).map((h) => (
                        <Link
                          key={h.id}
                          href={'#' + h.id}
                          style={{
                            display: 'block',
                            paddingLeft: Math.max(0, h.level - 2) * 10,
                            margin: '10px 0',
                          }}
                        >
                          {h.title}
                        </Link>
                      ))}
                    </nav>
                  </>
                )}
                <h2>继续阅读</h2>
                <Link href="/knowledge">查找其他词条</Link>
                <Link href="/knowledge#routes">浏览学习路线</Link>
                <p>同一篇词条可以被多个社区目录和学习路线收录。</p>
                {!cap.canContribute && <LoginNotice />}
              </aside>
            </div>
          ) : tab === 'history' ? (
            <KnowledgeHistory page={p} />
          ) : (
            <KnowledgeDiscussion pageId={pageId} />
          )}
        </>
      )}
    </div>
  );
}
