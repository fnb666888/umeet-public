import { ArrowUpRight, Compass } from 'lucide-react';
import { publicApi, type Community } from '../../lib/api';

export const dynamic = 'force-dynamic';
export default async function Communities() {
  const communities = await publicApi<Community[]>('/communities').catch(() => null);
  return <section>
    <div className="page-heading"><h1>发现</h1><p>浏览各个社区及其 Wiki。</p></div>
    {!communities ? <p role="status">暂时无法加载社区。</p> : !communities.length ? <p>还没有社区。</p> :
      <div className="demo-directory">
        {communities.map(c => <article className="panel demo-board" key={c.id}>
          <span className="board-mark"><Compass /></span>
          <div><h2><a href={'/c/' + c.slug}>{c.name}</a></h2><p className="muted">{c.description}</p></div>
          <a className="demo-link" href={'/c/' + c.slug + '/wiki'}>Wiki <ArrowUpRight /></a>
        </article>)}
      </div>}
  </section>;
}
