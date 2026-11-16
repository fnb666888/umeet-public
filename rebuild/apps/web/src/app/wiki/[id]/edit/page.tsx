import { WikiComposer } from '../../../../components/wiki/WikiComposer';
import { publicApi } from '../../../../lib/api';
import type {
  WikiPageMetadata,
  WikiRevisionDto,
} from '../../../../../../../packages/contracts/src/index';
export const dynamic = 'force-dynamic';
export default async function EditWiki({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [initial, meta] = await Promise.all([
    publicApi<WikiRevisionDto>('/wiki/' + encodeURIComponent(id)),
    publicApi<WikiPageMetadata>('/wiki/' + encodeURIComponent(id) + '/meta'),
  ]);
  return (
    <>
      <header className="page-heading">
        <h1>完善词条</h1>
        <p>你的每一次修订，都是下一位读者的起点。</p>
      </header>
      <WikiComposer
        initial={initial}
        communityId={meta.communityId}
        communitySlug={meta.communitySlug}
      />
    </>
  );
}
