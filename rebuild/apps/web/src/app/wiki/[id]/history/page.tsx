import { WikiHistory } from '../../../../components/wiki/WikiHistory';
import { publicApi } from '../../../../lib/api';
import type {
  WikiRevisionDto,
  WikiPageMetadata,
} from '../../../../../../../packages/contracts/src/index';
export const dynamic = 'force-dynamic';
export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [revisions, current, meta] = await Promise.all([
    publicApi<WikiRevisionDto[]>('/wiki/' + id + '/history'),
    publicApi<WikiRevisionDto>('/wiki/' + id),
    publicApi<WikiPageMetadata>('/wiki/' + id + '/meta'),
  ]);
  return (
    <div className="wiki-page">
      <header className="page-heading">
        <p>
          <a href={'/wiki/' + id}>返回词条</a>
        </p>
        <h1>{current.title} · 修订历史</h1>
        <p>对照每一处修改，保留知识演变的过程。</p>
      </header>
      <WikiHistory
        pageId={id}
        revisions={revisions}
        currentId={current.id}
        communitySlug={meta.communitySlug}
      />
    </div>
  );
}
