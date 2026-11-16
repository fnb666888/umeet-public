import { BookOpen } from 'lucide-react';
import { publicApi, type Community } from '../../lib/api';

export const dynamic = 'force-dynamic';
export default async function WikiDirectory() {
  const communities = await publicApi<Community[]>('/communities').catch(() => null);
  return <section>
    <div className="page-heading"><h1>Wiki</h1><p>选择社区，查看和共建其中的词条。</p></div>
    {communities ? <div className="demo-directory">{communities.map(c =>
      <a className="panel demo-board" key={c.id} href={'/c/' + c.slug + '/wiki'}>
        <span className="board-mark"><BookOpen /></span><div><h2>{c.name}</h2><p className="muted">{c.description}</p></div>
      </a>
    )}</div> : <p role="status">暂时无法加载社区 Wiki。</p>}
  </section>;
}
