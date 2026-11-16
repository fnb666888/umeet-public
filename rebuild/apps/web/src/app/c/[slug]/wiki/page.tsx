import { publicApi } from '../../../../lib/api';
export const dynamic = 'force-dynamic';
type Entry = { id: string; slug: string; title: string; created_at: string };
export default async function WikiIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pages = await publicApi<Entry[]>('/communities/' + encodeURIComponent(slug) + '/wiki');
  return (
    <>
      <div className="page-heading">
        <p>
          <a href={'/c/' + slug}>返回社区</a> / 独立 Wiki
        </p>
        <h1>知识，在每次编辑中生长。</h1>
        <p>一个词条，一个可以被理解和完善的知识点。</p>
      </div>
      <a className="primary" href={'/c/' + slug + '/wiki/new'}>
        新建词条
      </a>
      <div className="wiki-index">
        {pages.length ? (
          pages.map((p) => (
            <a key={p.id} href={'/wiki/' + p.id} className="panel entry-row">
              <h2>{p.title}</h2>
              <p>查看词条与修订历史</p>
            </a>
          ))
        ) : (
          <div className="panel empty-state">
            <h2>这个知识库还没有词条</h2>
            <p>从你熟悉的一个概念、地点或问题开始。</p>
          </div>
        )}
      </div>
    </>
  );
}
