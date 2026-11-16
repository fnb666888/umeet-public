import { notFound } from 'next/navigation';
import { WikiComposer } from '../../../../../components/wiki/WikiComposer';
import { publicApi, type Community } from '../../../../../lib/api';
export const dynamic = 'force-dynamic';
export default async function NewWiki({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const community = (await publicApi<Community[]>('/communities')).find((c) => c.slug === slug);
  if (!community) notFound();
  return (
    <>
      <header className="page-heading">
        <h1>为{community.name}创建词条</h1>
        <p>从一个清楚的问题或概念开始，留下可以持续完善的知识。</p>
      </header>
      <WikiComposer communityId={community.id} communitySlug={community.slug} />
    </>
  );
}
