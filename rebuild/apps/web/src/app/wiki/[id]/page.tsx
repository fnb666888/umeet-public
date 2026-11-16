import { notFound } from 'next/navigation';
import type {
  WikiPageMetadata,
  WikiRevisionDto,
  WikiLinkDto,
} from '../../../../../../packages/contracts/src/index';
import { apiUrl, publicApi } from '../../../lib/api';
import { WikiArticle } from '../../../components/wiki/WikiArticle';
import { WikiBookmark } from '../../../components/wiki/WikiBookmark';
export const dynamic = 'force-dynamic';
export default async function WikiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const response = await fetch(apiUrl('/wiki/' + encodeURIComponent(id)), {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('WIKI_UNAVAILABLE');
  const revision = (await response.json()) as WikiRevisionDto;
  const [meta, backlinks] = await Promise.all([
    publicApi<WikiPageMetadata>('/wiki/' + encodeURIComponent(id) + '/meta'),
    publicApi<WikiLinkDto[]>('/wiki/' + encodeURIComponent(id) + '/backlinks'),
  ]);
  return (
    <div className="wiki-page">
      <header className="page-heading">
        <p>
          <a href={'/c/' + meta.communitySlug + '/wiki'}>{meta.communityName} Wiki</a> / 词条
        </p>
        <h1>{revision.title}</h1>
        <p>
          {revision.authorAlias} ·{' '}
          {new Date(revision.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} ·{' '}
          {meta.protected ? '词条受保护' : '共同编辑'}
        </p>
      </header>
      <nav className="wiki-actions">
        <a className="primary" href={'/wiki/' + id + '/edit'}>
          编辑词条
        </a>
        <a href={'/wiki/' + id + '/history'}>修订历史</a>
        <WikiBookmark pageId={id} title={revision.title} />
      </nav>
      <article className="panel">
        <WikiArticle markdown={revision.markdown} communitySlug={meta.communitySlug} />
      </article>
      <section className="panel">
        <h2>引用此词条</h2>
        {backlinks.length ? (
          backlinks.map((link) => (
            <a className="text-link" key={link.pageId} href={'/wiki/' + link.pageId}>
              {link.title} <span className="muted">· {link.communitySlug}</span>
            </a>
          ))
        ) : (
          <p className="muted">还没有其他词条引用这里。</p>
        )}
      </section>
    </div>
  );
}
