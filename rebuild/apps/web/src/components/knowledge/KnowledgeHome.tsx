'use client';
import { SiteLink as Link } from '../SiteLink';
import { useState, useEffect } from 'react';
import { Route, BookOpen, ChevronRight } from 'lucide-react';
import type { KnowledgePage } from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge } from './useKnowledge';
import { KnowledgeActions, KnowledgeStatus, formatTime } from './KnowledgeUI';
type RouteSummary = {
  id: string;
  communityId: string;
  title: string;
  goal: string;
  version: number;
};
export function KnowledgeHome() {
  const [search, setSearch] = useState(''),
    [tab, setTab] = useState<'articles' | 'routes'>('articles');
  const articles = useKnowledge<{ items: KnowledgePage[]; nextCursor: string | null }>(
      'pages?q=' + encodeURIComponent(search),
    ),
    routes = useKnowledge<RouteSummary[]>('routes'),
    communities = useKnowledge<{ id: string; slug: string; name: string }[]>('communities');
  useEffect(() => {
    const q=new URLSearchParams(location.search).get('q');if(q)setSearch(q);
    const sync = () => {
      if (location.hash === '#routes') setTab('routes');
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  // Community listing uses the existing public endpoint, not a second directory source.
  return (
    <div className="knowledge knowledge-home">
      <header className="forum-heading knowledge-home-heading">
        <h1>Wiki</h1>
        <div className="knowledge-actions"><KnowledgeActions /></div>
      </header>
      {search && <p className="result-summary" role="status">「{search}」的词条 <Link href="/knowledge">清除搜索</Link></p>}
      <div className="knowledge-community-links">
        <span>按社区浏览</span>
        {(communities.data ?? []).map((c) => (
          <Link key={c.id} href={'/c/' + c.slug + '/knowledge'}>
            {c.name}
          </Link>
        ))}
      </div>
      <div className="knowledge-tabs" role="tablist" aria-label="知识库视图">
        <button role="tab" aria-selected={tab === 'articles'} onClick={() => setTab('articles')}>
          <BookOpen size={17} />
          词条
        </button>
        <button role="tab" aria-selected={tab === 'routes'} onClick={() => setTab('routes')}>
          <Route size={17} />
          学习路线
        </button>
      </div>
      {tab === 'articles' ? (
        <ArticleList key={search} search={search} resource={articles} />
      ) : (
        <>
          <KnowledgeStatus loading={routes.loading} error={routes.error} retry={routes.reload} />
          <div className="knowledge-route-list">
            {routes.data?.map((r) => (
              <Link className="knowledge-route-card" key={r.id} href={'/knowledge/routes/' + r.id}>
                <Route size={24} />
                <div>
                  <h2>{r.title}</h2>
                  <p>{r.goal}</p>
                </div>
                <ChevronRight size={20} />
              </Link>
            ))}
          </div>
          {routes.data?.length === 0 && (
            <div className="knowledge-empty">
              <h2>还没有学习路线</h2>
              <p>进入社区 Wiki，为一组词条安排目标、顺序和导读。</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function ArticleList({
  resource,
  search,
}: {
  resource: ReturnType<typeof useKnowledge<{ items: KnowledgePage[]; nextCursor: string | null }>>;
  search: string;
}) {
  const [extra, setExtra] = useState<KnowledgePage[]>([]),
    [cursor, setCursor] = useState<string | null | undefined>(undefined),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pages = [...(resource.data?.items ?? []), ...extra];
  const next = cursor === undefined ? resource.data?.nextCursor : cursor;
  return (
    <>
      <KnowledgeStatus
        loading={resource.loading}
        error={resource.error || error}
        retry={resource.reload}
      />
      <div className="knowledge-article-list">
        {pages.map((p) => (
          <Link key={p.id} className="knowledge-article-row" href={'/knowledge/' + p.id}>
            <BookOpen size={21} />
            <div>
              <h2>{p.title}</h2>
              <p>{p.summary || '打开词条阅读正文'}</p>
              <span>最后编辑 {formatTime(p.createdAt)}</span>
            </div>
            <ChevronRight size={18} />
          </Link>
        ))}
      </div>
      {resource.data && pages.length === 0 && (
        <div className="knowledge-empty">
          <h2>{search ? '没有找到相关词条' : '从第一篇词条开始'}</h2>
          <p>
            {search
              ? '试试其他名称，或创建一篇新的词条。'
              : '把一份办事指南或一个独立概念整理下来。'}
          </p>
          <Link className="knowledge-button knowledge-primary" href="/knowledge/new">
            创建词条
          </Link>
        </div>
      )}
      {next && (
        <button
          className="knowledge-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const { knowledge } = await import('./knowledge-client');
              const data = await knowledge<{ items: KnowledgePage[]; nextCursor: string | null }>(
                'pages?q=' + encodeURIComponent(search) + '&cursor=' + encodeURIComponent(next),
              );
              setExtra((p) => [...p, ...data.items]);
              setCursor(data.nextCursor);
            } catch (e) {
              setError(e instanceof Error ? e.message : '加载失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '正在加载…' : '加载更多词条'}
        </button>
      )}
    </>
  );
}
