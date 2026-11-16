import { discussionApi } from '../../../lib/discussions';
import { DiscussionReasonForm } from '../../../components/discussions/DiscussionActions';
import type { DiscussionReview } from '../../../../../../packages/contracts/src/discussions';

export default async function DiscussionModeration() {
  const result = await discussionApi<DiscussionReview>('/review', true);
  if (result.status === 401 || result.status === 403) {
    return (
      <div className="panel empty-state">
        <h1>举报处理</h1>
        <p>请使用社区版主或平台管理员账号登录。</p>
      </div>
    );
  }
  if (!result.data) throw new Error('DISCUSSION_REVIEW_UNAVAILABLE');
  const { posts } = result.data;
  return (
    <section>
      <div className="page-heading">
        <h1>举报处理</h1>
        <p>处理已公开帖子的举报。</p>
      </div>
      {posts.length === 0 && (
        <div className="panel empty-state">当前没有待处理的讨论。</div>
      )}
      {posts.map((post) => (
        <article className="panel discussion-card" key={post.id}>
          <div className="discussion-meta">
            <a href={'/c/' + post.communitySlug}>{post.communitySlug}</a>
            <span>被举报</span>
          </div>
          <h2>{post.title}</h2>
          <p className="discussion-body">{post.body}</p>
          {post.reports.length > 0 && (
            <ul aria-label="举报理由">
              {post.reports.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          )}
          <DiscussionReasonForm
            path={'/review/' + post.id}
            kind="post"
            published={post.state === 'public'}
          />
        </article>
      ))}
    </section>
  );
}
