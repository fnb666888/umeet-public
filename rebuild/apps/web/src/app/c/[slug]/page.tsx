import { notFound } from 'next/navigation';
import { publicApi, type Community } from '../../../lib/api';
import { DiscussionFeed } from '../../../components/discussions/DiscussionFeed';
import { DiscussionForm } from '../../../components/discussions/DiscussionActions';

export const dynamic = 'force-dynamic';
export default async function CommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  const [{ slug }, { after }, communities] = await Promise.all([
    params,
    searchParams,
    publicApi<Community[]>('/communities'),
  ]);
  const community = communities.find((c) => c.slug === slug);
  if (!community) notFound();
  return (
    <>
      <div className="community-header">
        <p>u / {slug}</p>
        <h1>{community.name}</h1>
        <p>{community.description}</p>
        <nav aria-label="社区导航">
          <a href={'/c/' + slug} aria-current="page">
            讨论
          </a>
          <a href={'/c/' + slug + '/wiki'}>共建 Wiki</a>
          <a href="/moderation/discussions">举报处理</a>
        </nav>
      </div>
      <details className="panel discussion-card">
        <summary>在这个社区发帖</summary>
        {slug === 'hollow' && <p className="muted">树洞帖子和回复以「匿名用户」显示。</p>}
        <DiscussionForm community={slug} />
      </details>
      <div className="feed-bar">
        <strong>社区帖子</strong>
        <span>最新</span>
      </div>
      <DiscussionFeed community={slug} after={typeof after === 'string' ? after : undefined} />
    </>
  );
}
