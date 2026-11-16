import { DiscussionFeed } from '../../components/discussions/DiscussionFeed';
import { publicApi, type Community } from '../../lib/api';
import type { WikiLinkDto } from '../../../../../packages/contracts/src/index';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; after?: string }> }) {
  const {q, after} = await searchParams;
  const query = typeof q === 'string' ? q.trim().slice(0,80) : '';
  if (!query) return <div className="page-heading"><h1>搜索</h1><p>在顶部输入关键词搜索帖子、词条和社区。</p></div>;
  const [communities, wiki] = await Promise.all([
    publicApi<Community[]>('/communities').catch(() => null),
    publicApi<WikiLinkDto[]>('/communities/wiki/search?q=' + encodeURIComponent(query)).catch(() => null),
  ]);
  const matches = communities?.filter(c => (c.name + ' ' + c.description).toLowerCase().includes(query.toLowerCase()));
  return <section>
    <div className="page-heading"><h1>搜索结果</h1><p>「{query}」</p></div>
    {!!matches?.length && <div className="panel"><h2>匹配的社区</h2>
      <ul>{matches.map(c => <li key={c.id}><a href={'/c/' + c.slug}>{c.name}</a></li>)}</ul>
    </div>}
    {!!wiki?.length && <div className="panel"><h2>匹配的 Wiki 词条</h2>
      <ul>{wiki.map(entry => <li key={entry.pageId}><a href={'/wiki/' + entry.pageId}>{entry.title}</a></li>)}</ul>
    </div>}
    <DiscussionFeed search={query} after={typeof after === 'string' ? after : undefined} />
  </section>;
}
