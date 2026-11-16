import type { CursorPage } from '../../../../../packages/contracts/src/index';
import type { DiscussionPost } from '../../../../../packages/contracts/src/discussions';
import { discussionApi } from '../../lib/discussions';
import { DiscussionCards } from './DiscussionCards';

export async function DiscussionFeed({ community, after, search, home = false }: {
  community?: string | undefined; after?: string | undefined; search?: string; home?: boolean;
}) {
  const params = new URLSearchParams();
  if (community) params.set('community', community);
  if (search) params.set('q', search);
  const base = search ? '/search?' + new URLSearchParams({q: search}) :
    home && community ? '/?board=' + encodeURIComponent(community) : community ? '/c/' + community : '/';
  if (after) params.set('after', after);
  const result = await discussionApi<CursorPage<DiscussionPost>>('?' + params).catch(() => null);
  if (!result?.data) return <div className="panel empty-state"><h2>{result?.status === 404 ? '这一页已失效' : '暂时无法加载帖子'}</h2><a href={base}>返回列表</a></div>;
  const { items, nextCursor } = result.data;
  return <section aria-label={search ? '帖子搜索结果' : community ? '本社区帖子' : '所有社区帖子'}>
    {search && items.length === 0 ? <p className="panel empty-state">没有匹配的公开帖子。</p> : <DiscussionCards items={items} />}
    <nav className="discussion-meta" aria-label="帖子分页">
      {after && <a href={base}>返回第一页</a>}
      {nextCursor && <a href={base + (base.includes('?') ? '&' : '?') + 'after=' + encodeURIComponent(nextCursor)}>下一页</a>}
    </nav>
  </section>;
}
