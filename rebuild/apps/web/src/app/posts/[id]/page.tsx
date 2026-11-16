import { notFound } from 'next/navigation';
import { WikiBookmark } from '../../../components/wiki/WikiBookmark';
import { discussionApi } from '../../../lib/discussions';
import {
  DiscussionForm,
  DiscussionReasonForm,
  DiscussionVote,
} from '../../../components/discussions/DiscussionActions';
import type {
  DiscussionComment,
  DiscussionDetail,
} from '../../../../../../packages/contracts/src/discussions';

const date = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
});
function Comment({ comment }: { comment: DiscussionComment }) {
  return (
    <>
      <div className="discussion-meta">
        <strong>{comment.author}</strong>
        <time dateTime={comment.createdAt}>{date.format(new Date(comment.createdAt))}</time>
      </div>
      <p className="discussion-body">{comment.body}</p>
    </>
  );
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const result = await discussionApi<DiscussionDetail>('/' + encodeURIComponent(id), true);
  if (result.status === 404) notFound();
  if (!result.data) throw new Error('DISCUSSION_UNAVAILABLE');
  const { post, comments, vote, canModerate } = result.data;
  const replies = new Map<string, DiscussionComment[]>();
  for (const comment of comments) {
    if (comment.parentId) {
      const siblings = replies.get(comment.parentId) ?? [];
      siblings.push(comment);
      replies.set(comment.parentId, siblings);
    }
  }
  return (
    <div className="discussion-thread">
      <div className="discussion-meta">
        <a href={'/c/' + post.communitySlug}>{post.communityName}</a>
        <a href={'/c/' + post.communitySlug + '/wiki'}>本社区 Wiki</a>
      </div>
      <article className="panel discussion-card">
        <h1>{post.title}</h1>
        <div className="discussion-meta">
          <strong>{post.author}</strong>
          <time dateTime={post.publishedAt}>{date.format(new Date(post.publishedAt))}</time>
        </div>
        <p className="discussion-body">{post.body}</p>
        <DiscussionVote postId={id} score={post.score} vote={vote} />
        <WikiBookmark pageId={id} title={post.title} post />
        <details>
          <summary>举报帖子</summary>
          <DiscussionReasonForm path={'/' + id + '/report'} report />
        </details>
        {canModerate && (
          <details>
            <summary>处理帖子</summary>
            <DiscussionReasonForm path={'/review/' + id} kind="post" published />
          </details>
        )}
      </article>
      <section id="comments">
        <h2>回复 · {post.replyCount}</h2>
        <div className="panel discussion-card">
          <DiscussionForm postId={id} />
        </div>
        {comments
          .filter((comment) => comment.parentId === null)
          .map((comment) => (
            <article className="panel discussion-card" key={comment.id}>
              <Comment comment={comment} />
              <details>
                <summary>回复 {comment.author}</summary>
                <DiscussionForm postId={id} parentId={comment.id} />
              </details>
              {replies.get(comment.id)?.map((reply) => (
                <div className="discussion-reply" key={reply.id}>
                  <Comment comment={reply} />
                </div>
              ))}
            </article>
          ))}
      </section>
    </div>
  );
}
