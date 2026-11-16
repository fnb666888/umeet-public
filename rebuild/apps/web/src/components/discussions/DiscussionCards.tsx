'use client';
import { useState } from 'react';
import { ArrowUp, LayoutGrid, List, MessageCircle } from 'lucide-react';
import type { DiscussionPost } from '../../../../../packages/contracts/src/discussions';

const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' });
export function DiscussionCards({ items }: { items: DiscussionPost[] }) {
  const [compact, setCompact] = useState(false);
  return <>
    <div className="demo-feed-toolbar"><strong>最新帖子</strong>
      <div className="demo-segment" role="group" aria-label="帖子显示方式">
        <button type="button" aria-pressed={!compact} onClick={() => setCompact(false)}><LayoutGrid />卡片</button>
        <button type="button" aria-pressed={compact} onClick={() => setCompact(true)}><List />紧凑</button>
      </div>
    </div>
    {items.length === 0 ? <div className="panel empty-state"><h2>还没有公开帖子</h2><p>欢迎发起第一场讨论。</p></div> :
      <div className={compact ? 'demo-feed is-compact' : 'demo-feed'}>
        {items.map(post => <article className="demo-feed-post" key={post.id}>
          <div className="demo-post-meta"><a href={'/c/' + post.communitySlug}>{post.communityName}</a><span>{post.author}</span><time dateTime={post.publishedAt}>{date.format(new Date(post.publishedAt))}</time></div>
          <h2><a href={'/posts/' + post.id}>{post.title}</a></h2>
          {!compact && <p className="discussion-excerpt">{post.body}</p>}
          <div className="demo-post-foot"><span aria-label={'得分 ' + post.score}><ArrowUp />{post.score}</span><a href={'/posts/' + post.id + '#comments'}><MessageCircle />{post.replyCount} 回复</a></div>
        </article>)}
      </div>}
  </>;
}
