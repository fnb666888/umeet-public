'use client';
import { navigateCommunity } from '../../lib/community-route';
import { useEffect, useRef, useState } from 'react';
import { useCommunity } from './store';
import { Icon } from './Icon';
import { RichText } from './content';
import { readRecord, useReading } from './reading';
import { PostModeration } from './PostModeration';
import { ReportButton } from './Governance';
import { ContentCorrection } from './ContentCorrection';
import { PostPoll } from '../interest/Poll';
import {
  age,
  authorHref,
  boards,
  inboxHref,
  postHref,
  readImage,
  replyHref,
  type Post,
  type Reply,
} from './model';

export function PostStatus({ post }: { post: Post }) {
  const { data } = useCommunity();
  return (
    <>
      {post.pinned && <span className="post-status">置顶</span>}
      {post.locked && <span className="post-status">回复已锁定</span>}
      {post.archived && <span className="post-status">已归档</span>}
      {post.community === 'questions' && (
        <span
          className={
            'post-status question-status ' + (data?.userState.best[post.id] ? 'solved' : 'pending')
          }
        >
          <Icon name={data?.userState.best[post.id] ? 'circle-check' : 'clock'} />
          {data?.userState.best[post.id] ? '已解决' : '待解答'}
        </span>
      )}
      {post.community === 'market' && (
        <span className={'post-status market-status ' + (post.sold ? 'is-sold' : 'is-available')}>
          {post.sold ? <Icon name="circle-minus" /> : <span className="status-dot" />}
          {post.sold ? '已出' : '在售'}
        </span>
      )}
    </>
  );
}
export function BoardLink({ post }: { post: Post }) {
  const { data } = useCommunity();
  const board = boards.find((board) => board.slug === post.community) ?? {
    slug: post.community, name: data?.boards?.find(board => board.slug === post.community)?.name || post.community,
    icon: 'messages-square',
  };
  return (
    <a className="thread-board" href={'#/c/' + board.slug}>
      <Icon name={board.icon} />
      {board.name}
    </a>
  );
}
export function Byline({ post }: { post: Post }) {
  return (
    <span className="thread-byline">
      <a className="thread-author" href={authorHref(post.authorId)}>
        {post.author}
      </a>
      <span aria-hidden="true">·</span>
      <span className="thread-published">{age(post)}</span>
    </span>
  );
}
export function Tags({ post, compact = false }: { post: Post; compact?: boolean }) {
  const links = post.tags?.map((tag) => (
    <a key={tag} className="tag-pill" href={'#/tag/' + encodeURIComponent(tag)}>
      {tag}
    </a>
  ));
  return post.tags?.length ? (
    compact ? (
      <span className="thread-tags" aria-label="标签">
        {links}
      </span>
    ) : (
      <div className="tags-row">{links}</div>
    )
  ) : null;
}
export function Vote({ post, reply }: { post: Post; reply?: Reply }) {
  const { data, busy, mutate } = useCommunity();
  const active = reply
    ? data?.userState.commentLikes.includes(post.id + ':' + reply.id)
    : data?.userState.likes.includes(post.id);
  return (
    <button
      type="button"
      className={'act ' + (reply ? 'clike' : 'like-post') + (active ? ' liked' : '')}
      aria-label={reply ? '点赞回复' : '点赞'}
      aria-pressed={Boolean(active)}
      disabled={busy}
      onClick={() =>
        void mutate([
          reply
            ? { type: 'reply.vote', postId: post.id, replyId: reply.id, value: !active }
            : { type: 'post.vote', postId: post.id, value: !active },
        ])
      }
    >
      <Icon name="heart" />
      <span className="cnt">{(reply?.likes ?? post.likes) + Number(Boolean(active))}</span>
    </button>
  );
}
export function Bookmark({ post, compact = false }: { post: Post; compact?: boolean }) {
  const { data, busy, toggleState } = useCommunity();
  const active = data?.userState.bookmarks?.includes(post.id) || false;
  return (
    <button
      type="button"
      className={'act star ' + (active ? 'on' : '')}
      data-bmk={post.id}
      aria-label={compact ? '收藏' : undefined}
      aria-pressed={active}
      disabled={busy}
      onClick={() => void toggleState('bookmarks', post.id)}
    >
      <Icon name="bookmark" />
      {!compact && (active ? '已收藏 ' : '收藏 ')}
      {(post.stars || 0) + Number(active)}
    </button>
  );
}
export function Meeting({ post }: { post: Post }) {
  const date = post.meetingAt
    ? new Date(post.meetingAt).toLocaleString('zh-CN', {
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '';
  return date || post.meeting ? (
    <p className="post-meeting">
      <b>集合信息</b> {[date, post.meeting].filter(Boolean).join(' · ')}
    </p>
  ) : null;
}
export function FeedCard({ post }: { post: Post }) {
  const { data } = useCommunity();
  const replies = data?.content.comments[post.id] || [];
  const latest = [...replies].sort((a, b) => b.createdAt - a.createdAt)[0];
  const excerpt = post.body || post.project?.work || post.project?.feedback || post.project?.access;
  return (
    <article className="card feed-post" data-post={post.id}>
      <div className="meta">
        <BoardLink post={post} />
        <Byline post={post} />
        {post.project && <span className="project-badge">校园作品</span>}
        {post.price && <span className="thread-price">{post.price}</span>}
      </div>
      <div className="topic-title-line">
        <h2>
          <a href={postHref(post)}>{post.title}</a>
        </h2>
        <PostStatus post={post} />
      </div>
      {excerpt && excerpt !== post.title && <p className="excerpt">{excerpt}</p>}
      <Meeting post={post} />
      <Tags post={post} />
      {!!post.images?.length && (
        <div className="card-media">
          <img src={post.images[0]} alt="" />
        </div>
      )}
      <div className="foot">
        <Vote post={post} />
        <a className="act" href={postHref(post) + '#comments'}>
          <Icon name="message-circle" />
          <span>{post.replyCount ?? replies.length} 回复</span>
        </a>
        <Bookmark post={post} compact />
        <UnreadReplies post={post} />
      </div>
      {latest && (
        <a className="latest-reply" href={replyHref(post, latest)}>
          <span>最后回复</span> <strong>{latest.author}</strong>
          <time dateTime={new Date(latest.createdAt).toISOString()}>{age(latest)}</time>
        </a>
      )}
    </article>
  );
}
export function PostList({ posts }: { posts: Post[] }) {
  const { data, view, compose } = useCommunity();
  if (!posts.length)
    return (
      <div className="empty">
        {view === 'card' ? (
          <>
            <p>还没有帖子</p>
            <button className="btn-primary" onClick={() => compose()}>
              发第一条帖子
            </button>
          </>
        ) : (
          '还没有帖子'
        )}
      </div>
    );
  if (view === 'card')
    return (
      <div className="feed-stack">
        {posts.map((post) => (
          <FeedCard key={post.id} post={post} />
        ))}
      </div>
    );
  return (
    <div className="rows">
      <div className="rows-head" aria-hidden="true">
        <span>话题</span>
        <span className="r-num">回复</span>
        <span className="r-time">最近更新</span>
      </div>
      {posts.map((post) => {
        const replies = data?.content.comments[post.id] || [];
        const latest = [...replies].sort((a, b) => b.createdAt - a.createdAt)[0];
        return (
          <div className="row-item" key={post.id}>
            <div className="row-topic">
              <a
                className="thread-avatar"
                href={authorHref(post.authorId)}
                aria-label={'查看' + post.author + '的主页'}
              >
                {Array.from(post.author)[0]}
              </a>
              <div className="thread-text">
                <div className="topic-title-line">
                  <a className="r-title" href={postHref(post)}>
                    {post.title}
                  </a>
                  <PostStatus post={post} />
                </div>
                <div className="r-meta">
                  <BoardLink post={post} />
                  {post.project && <span className="project-badge">校园作品</span>}
                  {post.price && <span className="thread-price">{post.price}</span>}
                  <UnreadReplies post={post} />
                  <Tags post={post} compact />
                  {['questions', 'resources'].includes(post.community) && <Vote post={post} />}
                </div>
              </div>
            </div>
            <a
              className="r-num"
              href={postHref(post) + '#comments'}
              aria-label={(post.replyCount ?? replies.length) + ' 条回复'}
            >
              {post.replyCount ?? replies.length}
            </a>
            <a className="r-time" href={latest ? replyHref(post, latest) : postHref(post)}>
              <time dateTime={new Date(post.activityAt || (latest || post).createdAt).toISOString()}>
                {age(post.activityAt?{createdAt:post.activityAt}:latest || post)}
              </time>
            </a>
          </div>
        );
      })}
    </div>
  );
}
function UnreadReplies({ post }: { post: Post }) {
  const { data } = useCommunity();
  const record = readRecord('umeet-reading-' + (data?.actor?.userId || 'guest') + '-' + post.id);
  const replies = record
    ? (data!.content.comments[post.id] || []).filter(
        (reply) => reply.authorId !== data!.actor?.userId && !record.seen.includes(reply.id),
      )
    : [];
  return replies.length ? (
    <a className="unread-replies" href={replyHref(post, replies[0])}>
      {replies.length} 条新回复
    </a>
  ) : null;
}
export function ViewControls({ className = '' }: { className?: string }) {
  const { view, setView } = useCommunity();
  return (
    <div className={'seg view-controls ' + className} role="group" aria-label="帖子显示方式">
      {(['card', 'compact'] as const).map((value) => (
        <button
          key={value}
          className={view === value ? 'on' : ''}
          data-view={value}
          aria-pressed={view === value}
          onClick={() => setView(value)}
        >
          <Icon name={value === 'card' ? 'layout-grid' : 'list'} />
          {value === 'card' ? '卡片' : '紧凑'}
        </button>
      ))}
    </div>
  );
}
export function sortPosts(
  posts: Post[],
  mode: string,
  data: NonNullable<ReturnType<typeof useCommunity>['data']>,
) {
  const activity = (post: Post) =>
    Math.max(
      post.createdAt,
      ...(data.content.comments[post.id] || []).map((reply) => reply.createdAt),
    );
  const hot = (post: Post) =>
    post.likes +
    Number(data.userState.likes.includes(post.id)) -
    (2 * (Date.now() - post.createdAt)) / 3600000;
  return [...posts].sort(
    (a, b) =>
      Number(b.pinned || false) - Number(a.pinned || false) ||
      (mode === 'hot'
        ? hot(b) - hot(a)
        : mode === 'activity'
          ? activity(b) - activity(a)
          : b.createdAt - a.createdAt),
  );
}

function AnswerWiki({ post, reply }: { post: Post; reply: Reply }) {
  const { data, busy, mutate } = useCommunity();
  const [value, setValue] = useState(post.wikiRef?.id || '');
  const [query,setQuery]=useState('');
  const [options,setOptions]=useState<{id:string;title:string}[]>([]);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if(!data?.partial)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      void fetch('/api/backend/demo/pages/wiki-options?'+new URLSearchParams({board:post.community,q:query}),{signal:controller.signal})
        .then(async response=>{if(!response.ok)throw new Error();return response.json();})
        .then(result=>{setOptions(result.items);setFailed(false);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    },200);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[data?.partial,post.community,query]);
  const wiki = data?.partial?options:data!.content.wiki.filter((wiki) => wiki.communities.includes(post.community));
  if (!wiki.length&&!data?.partial) return null;
  return (
    <form
      className="answer-wiki"
      data-answer={reply.id}
      onSubmit={async (event) => {
        event.preventDefault();
        await mutate(
          [{ type: 'post.wiki', postId: post.id, wikiId: value || null }],
          value ? '已关联词条' : '已移除词条关联',
        );
      }}
    >
      <label htmlFor="answer-wiki-id">将答案关联到Wiki</label>
      {data?.partial&&<input aria-label="搜索可关联词条" placeholder="搜索词条" value={query} onChange={event=>setQuery(event.target.value)} />}
      {failed&&<span role="alert">词条暂时无法读取，请重新搜索</span>}
      <select id="answer-wiki-id" value={value} onChange={(event) => setValue(event.target.value)}>
        <option value="">不关联</option>
        {value&&!wiki.some(wiki=>wiki.id===value)&&<option value={value}>{value}</option>}
        {wiki.map((wiki) => (
          <option key={wiki.id} value={wiki.id}>
            {wiki.title}
          </option>
        ))}
      </select>
      <button type="submit" className="btn-ghost" disabled={busy}>
        保存关联
      </button>
    </form>
  );
}
function Comment({
  post,
  reply,
  childrenMap,
  replyTo,
  ancestors = [],
}: {
  post: Post;
  reply: Reply;
  childrenMap: Map<string, Reply[]>;
  replyTo: (reply: Reply) => void;
  ancestors?: string[];
}) {
  const { data, mutate, busy, hash } = useCommunity();
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const targetId = hash.split('#')[2]?.replace(/^cm-/, '');
    const replies = data!.content.comments[post.id] || [];
    const visited = new Set<string>();
    let target = replies.find((item) => item.id === targetId);
    while (target?.parentId && !visited.has(target.id)) {
      visited.add(target.id);
      if (target.parentId === reply.id) {
        setCollapsed(false);
        setExpanded(true);
        break;
      }
      target = replies.find((item) => item.id === target!.parentId);
    }
  }, [hash, post.id, reply.id, data]);
  const best = data!.userState.best[post.id] === reply.id;
  const kids = (childrenMap.get(reply.id) || []).filter((item) => !ancestors.includes(item.id));
  const shown = collapsed ? [] : expanded ? kids : kids.slice(0, 2);
  const own = data!.actor?.userId === post.authorId;
  return (
    <article
      className={'comment ' + (best ? 'best' : '')}
      id={'cm-' + reply.id}
      data-depth={Math.min(ancestors.length, 3)}
      tabIndex={-1}
    >
      <div className="c-head">
        <a className="name" href={authorHref(reply.authorId)}>
          {reply.author}
        </a>
        {reply.authorId === post.authorId && <span className="op">楼主</span>}
        <time>{age(reply)}</time>
        {best && <span className="best-mark">最佳回复</span>}
      </div>
      {reply.replyTo && (
        <a className="c-quote" href={postHref(post) + '#cm-' + reply.replyTo}>
          回复 @{reply.replyToName}：{reply.replyBody?.slice(0, 30)}…
        </a>
      )}
      {reply.body && <div className="c-body">{reply.body}</div>}
      {Object.entries(reply.moderationLabels || {}).map(([label, reason]) => (
        <p className="wiki-protection-note" key={label}>
          {label === 'revision' ? '请作者修改' : label === 'spam' ? '垃圾信息标记' : '管理说明'} ·{' '}
          {reason}
        </p>
      ))}
      {reply.image && <img className="reply-image" src={reply.image} alt="回复图片" />}
      {reply.authorId === data!.actor?.userId && <ContentCorrection post={post} reply={reply} />}
      <div className="c-foot">
        {reply.authorId !== data!.actor?.userId && (
          <ReportButton target={'reply:' + post.id + ':' + reply.id} boards={[post.community]} />
        )}
        <Vote post={post} reply={reply} />
        <button className="act creply" onClick={() => replyTo(reply)}>
          回复
        </button>
        <button
          className="act"
          aria-label="复制此回复链接"
          onClick={() => void copyLink(replyHref(post, reply))}
        >
          复制链接
        </button>
        {kids.length > 0 && (
          <a className="act" href={postHref(post) + '?thread=' + reply.id + '#comments'}>
            只看这串
          </a>
        )}
        {own && post.community === 'questions' && (
          <button
            className="act cbest"
            disabled={busy}
            onClick={() =>
              void mutate([
                { type: 'post.accept', postId: post.id, replyId: best ? null : reply.id },
              ])
            }
          >
            {best ? '取消采纳' : '采纳为最佳回复'}
          </button>
        )}
      </div>
      {best && own && <AnswerWiki post={post} reply={reply} />}
      {kids.length > 0 && (
        <>
          <button
            className="fold"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? '展开 ' + kids.length + ' 条回复' : '折叠回复'}
          </button>
          <div className="replies" hidden={collapsed}>
            {shown.map((child) => (
              <Comment
                key={child.id}
                post={post}
                reply={child}
                childrenMap={childrenMap}
                replyTo={replyTo}
                ancestors={[...ancestors, reply.id]}
              />
            ))}
          </div>
          {!collapsed && shown.length < kids.length && (
            <button className="fold" onClick={() => setExpanded(true)}>
              展开其余 {kids.length - shown.length} 条回复
            </button>
          )}
        </>
      )}
    </article>
  );
}
export async function copyLink(href: string) {
  const value = new URL(href, location.href).href;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    prompt('复制链接', value);
  }
}
export function PostPage({
  id,
  thread,
  anchor,
}: {
  id: string;
  thread: string | null;
  anchor: string;
}) {
  const { data, siteSettings, busy, mutate, toggleState, toast, requireLogin, origin, loadMore, moreLoading } =
    useCommunity();
  const order = new URLSearchParams(useCommunity().hash.split('?')[1]?.split('#')[0]).get('sort')==='latest'?'latest':'hot';
  const [expanded, setExpanded] = useState(false);
  const [share, setShare] = useState(false);
  const [target, setTarget] = useState<Reply | null>(null);
  const [reply, setReply] = useState('');
  const [image, setImage] = useState('');
  const [update, setUpdate] = useState('');
  const replyInput = useRef<HTMLInputElement>(null);
  const replyFile = useRef<HTMLInputElement>(null);
  const draftKey = 'umeet-reply-' + (data?.actor?.userId || 'guest') + '-' + id;
  useReading(
    'umeet-reading-' + (data?.actor?.userId || 'guest') + '-' + id,
    data!.content.comments[id] || [],
    anchor,
    thread,
  );
  useEffect(() => {
    try {
      const previous = JSON.parse(
        localStorage.getItem('umeet-drafts-' + data?.actor?.userId) || '{}',
      );
      const legacy = new Map<string, { text?: string; image?: string; target?: { id: string } }>(
        previous.replyDrafts || [],
      ).get(id);
      const saved = JSON.parse(localStorage.getItem(draftKey) || 'null') || legacy || {};
      setReply(saved.text || '');
      setImage(saved.image || '');
      setTarget(data!.content.comments[id]?.find((reply) => reply.id === saved.target?.id) || null);
    } catch {
      toast('回复草稿未能恢复');
    }
  }, [draftKey, toast]);
  useEffect(() => {
    if (!anchor) return;
    const timer = setTimeout(() => {
      const element = document.getElementById(anchor);
      element?.scrollIntoView({ block: 'start' });
      element?.focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [anchor, data]);
  const post = data!.content.posts.find((post) => post.id === id);
  if (!post || post.summary)
    return (
      <div className="empty">
        {post?.summary ? '正在打开帖子' : data!.tombstones?.some((post) => post.id === id) ? '该帖子已被管理员移除' : '帖子不存在'}，
        <a href="#/">返回首页</a>
      </div>
    );
  const saveDraft = (text: string, image: string, replyTarget: Reply | null = target) => {
    setReply(text);
    setImage(image);
    setTarget(replyTarget);
    try {
      localStorage.setItem(draftKey, JSON.stringify({ text, image, target: replyTarget }));
    } catch {
      toast('浏览器未能保存草稿，请保留当前页面');
    }
  };
  const replies = data!.content.comments[id] || [];
  const accepted = data!.userState.best[id];
  const children = new Map<string, Reply[]>();
  const score = (reply: Reply) =>
    reply.likes + Number(data!.userState.commentLikes.includes(id + ':' + reply.id));
  for (const item of [...replies].sort((a, b) =>
    order === 'hot' ? score(b) - score(a) || b.createdAt - a.createdAt : b.createdAt - a.createdAt,
  )) {
    const parent = item.id === accepted && !thread ? '' : item.parentId || '';
    children.set(parent, [...(children.get(parent) || []), item]);
  }
  const selected = replies.find((reply) => reply.id === thread);
  const roots = selected
    ? [selected]
    : [...(children.get('') || [])].sort(
        (a, b) => Number(b.id === accepted) - Number(a.id === accepted),
      );
  const own = post.authorId === data!.actor?.userId;
  const following = data!.userState.follows?.includes(id) || false;
  const board = boards.find((board) => board.slug === post.community)!;
  const related = data!.content.posts
    .filter(
      (item) =>
        item.id !== id &&
        (item.community === post.community || item.tags?.some((tag) => post.tags?.includes(tag))),
    )
    .slice(0, 3);
  const send = async () => {
    if (busy || !requireLogin() || (!reply.trim() && !image)) return;
    const replyId = 'c' + crypto.randomUUID();
    if (
      await mutate(
        [
          {
            type: 'reply.create',
            postId: id,
            reply: {
              id: replyId,
              body: reply.trim(),
              ...(image ? { image } : {}),
              ...(target ? { parentId: target.id, replyTo: target.id } : {}),
            },
          },
        ],
        '回复已发布',
      )
    ) {
      saveDraft('', '', null);
      navigateCommunity(postHref(post) + '#cm-' + replyId);
    }
  };
  return (
    <>
      <a className="back" id="post-back" href={origin?.href || '#/c/' + post.community}>
        ← 返回 {origin?.label || board.name}
      </a>
      <article className="card post-card" data-topic={id}>
        <div className="meta">
          <BoardLink post={post} />
          <Byline post={post} />
          {post.price && <span className="thread-price">{post.price}</span>}
          {post.project && <span className="project-badge">校园作品</span>}
        </div>
        <div className="topic-title-line post-title-line">
          <h1>{post.title}</h1>
          <PostStatus post={post} />
        </div>
        <Tags post={post} />
        <PostModeration post={post} />
        {Object.entries(post.moderationLabels || {}).map(([label, reason]) => (
          <p className="wiki-protection-note" key={label}>
            {label === 'revision' ? '请作者修改' : label === 'spam' ? '垃圾信息标记' : '管理说明'} ·{' '}
            {reason}
          </p>
        ))}
        <Meeting post={post} />
        <div
          className={
            'body body-html ' + (post.body.length > 320 && !expanded ? 'body-collapsed' : '')
          }
          id="post-body"
        >
          {post.html ? <RichText html={post.html} /> : post.body}
        </div>
        {post.body.length > 320 && (
          <div className="expand-bar">
            <button onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开全文'}</button>
          </div>
        )}
        {!!post.images?.length && (
          <div className="card-media">
            {post.images.map((image, index) => (
              <img key={index} src={image} alt="" />
            ))}
          </div>
        )}
        {post.project && (
          <dl className="project-details">
            {(
              [
                ['work', '做了什么'],
                ['access', '怎么体验'],
                ['feedback', '想听什么反馈'],
              ] as const
            ).map(
              ([key, label]) =>
                post.project?.[key] && (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {key === 'access' && /^https?:\/\/\S+$/i.test(post.project[key]!) ? (
                        <a href={post.project[key]} target="_blank" rel="noopener noreferrer">
                          {post.project[key]}
                        </a>
                      ) : (
                        post.project[key]
                      )}
                    </dd>
                  </div>
                ),
            )}
          </dl>
        )}
        {!!post.updates?.length && (
          <section className="topic-updates" aria-label="楼主进展">
            <h2>楼主进展</h2>
            {post.updates.map((update, index) => (
              <article key={index}>
                <time>{new Date(update.createdAt).toLocaleString('zh-CN')}</time>
                <p>{update.body}</p>
              </article>
            ))}
          </section>
        )}
        {own && <ContentCorrection post={post} />}
        {own && (
          <details className="topic-update-editor">
            <summary>追加进展</summary>
            <form
              id="topic-update-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (
                  await mutate(
                    [{ type: 'post.update', postId: id, body: update.trim() }],
                    '已追加进展',
                  )
                )
                  setUpdate('');
              }}
            >
              <label className="sr-only" htmlFor="topic-update-text">
                进展内容
              </label>
              <textarea
                id="topic-update-text"
                maxLength={500}
                required
                value={update}
                onChange={(event) => setUpdate(event.target.value)}
                placeholder="补充结果、地点变更或新的资料"
              />
              <button type="submit" className="btn-primary" disabled={busy}>
                发布进展
              </button>
            </form>
          </details>
        )}
        <div className="post-vote">
          <Vote post={post} />
          <Bookmark post={post} />
          <button
            className={'act follow ' + (following ? 'on' : '')}
            data-follow={id}
            aria-pressed={following}
            disabled={busy}
            onClick={() => void toggleState('follows', id)}
          >
            <Icon name="bell" />
            {following ? '已关注' : '关注'}
          </button>
          {own && post.community === 'market' && (
            <button
              className="act"
              id="market-toggle"
              disabled={busy}
              onClick={() => void mutate([{ type: 'post.sold', postId: id, value: !post.sold }])}
            >
              {post.sold ? '恢复在售' : '标记已出'}
            </button>
          )}
          {!own && ['market', 'buddies'].includes(post.community) && (
            <a className="act" href={inboxHref(post.authorId, id)}>
              {post.community === 'market' ? '联系卖家' : '联系发起人'}
            </a>
          )}
          <span className="share-wrap">
            <button
              className="act share-toggle"
              aria-expanded={share}
              onClick={() => setShare(!share)}
            >
              <Icon name="share-2" />
              分享
            </button>
            <span className="share-drop" hidden={!share}>
              <button
                data-share="copy"
                onClick={() => {
                  void copyLink(postHref(post));
                  setShare(false);
                  toast('链接已复制');
                }}
              >
                <Icon name="link" />
                复制链接
              </button>
              <button
                data-share="poster"
                onClick={() => {
                  void downloadPoster(post, toast);
                  setShare(false);
                }}
              >
                <Icon name="image" />
                生成分享海报
              </button>
              <button
                onClick={() => {
                  navigateCommunity(inboxHref('', id));
                }}
              >
                <Icon name="inbox" />
                转发给同学
              </button>
            </span>
          </span>
          <span className="spacer" />
          {post.authorId !== data!.actor?.userId && (
            <ReportButton target={'post:' + id} boards={[post.community]} />
          )}
        </div>
      </article>
      <PostPoll postId={id} own={own} />
      <section id="comments" tabIndex={-1} aria-labelledby="reply-heading">
        <div className="comments-head">
          <h2 id="reply-heading">{selected ? '当前讨论串' : '回复 · ' + (post.replyCount ?? replies.length)}</h2>
          <div className="seg" role="group" aria-label="回复排序">
            {['hot', 'latest'].map((value) => (
              <button
                key={value}
                className={order === value ? 'on' : ''}
                aria-pressed={order === value}
                onClick={() => {const params=new URLSearchParams(location.search);params.set('sort',value);navigateCommunity(postHref(post)+'?'+params+'#comments');}}
              >
                {value === 'hot' ? '最热' : '最新'}
              </button>
            ))}
          </div>
        </div>
        {selected && (
          <a className="thread-return" href={replyHref(post, selected)}>
            ← 返回全部回复中的这一楼
          </a>
        )}
        <div id="cmts">
          {roots.map((reply) => (
            <Comment
              key={reply.id}
              post={post}
              reply={reply}
              childrenMap={children}
              replyTo={(reply) => {
                if (requireLogin()) {
                  saveDraft(replyInput.current?.value || '', image, reply);
                  replyInput.current?.focus();
                }
              }}
            />
          ))}
          {!roots.length && (
            <div className="empty">
              还没有回复，
              <button className="act" onClick={() => replyInput.current?.focus()}>
                写下第一条回复
              </button>
            </div>
          )}
        </div>
        {data?.partial&&data.page?.next&&<button className="btn-ghost" onClick={()=>void loadMore().catch(()=>{})} disabled={moreLoading}>{moreLoading?'正在读取更多回复…':'加载更多回复'}</button>}
      </section>
      <div className="comments-head" style={{ marginTop: 30 }}>
        <h2>相关讨论</h2>
      </div>
      {related.length ? (
        <div className="suggest-grid">
          {related.map((post) => (
            <FeedCard key={post.id} post={post} />
          ))}
        </div>
      ) : (
        <a className="link-btn" href={'#/c/' + post.community}>
          查看更多{board.name}
        </a>
      )}
      <div className="composer-bar" id="composer-bar">
        {target && (
          <div className="quote-bar">
            <span>
              ↩ 正在回复 <b>{target.author}</b>：{target.body.slice(0, 30)}…
            </span>
            <button
              className="x"
              id="quote-x"
              aria-label="取消引用"
              onClick={() => saveDraft(reply, image, null)}
            >
              ×
            </button>
          </div>
        )}
        {image && (
          <div className="reply-image-preview">
            <img src={image} alt="待发送图片" />
            <button
              className="link-btn"
              id="reply-remove-image"
              onClick={() => saveDraft(reply, '')}
            >
              移除图片
            </button>
          </div>
        )}
        <div className="composer-row">
          <input
            ref={replyInput}
            id="reply-input"
            aria-label="回复内容"
            placeholder={
              siteSettings?.boards[post.community]?.posting?.readonly
                ? '此板块暂停回复'
                : post.locked
                  ? '该帖已锁定回复'
                  : target
                    ? '回复 @' + target.author + '…'
                    : '友善地写下你的回复…'
            }
            disabled={
              post.locked ||
              post.archived ||
              siteSettings?.boards[post.community]?.posting?.readonly
            }
            maxLength={500}
            value={reply}
            onChange={(event) => saveDraft(event.target.value, image)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) void send();
            }}
          />
          <button
            className="act reply-attach"
            id="reply-add-image"
            disabled={
              post.locked ||
              post.archived ||
              siteSettings?.boards[post.community]?.posting?.readonly
            }
            onClick={() => replyFile.current?.click()}
          >
            {image ? '换图' : '图片'}
          </button>
          <input
            ref={replyFile}
            type="file"
            id="reply-file"
            accept="image/*"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file)
                try {
                  saveDraft(reply, await readImage(file));
                } catch (failure) {
                  toast((failure as Error).message);
                }
            }}
          />
          <button
            className="btn-send"
            id="reply-send"
            disabled={
              busy ||
              post.locked ||
              post.archived ||
              siteSettings?.boards[post.community]?.posting?.readonly
            }
            onClick={() => void send()}
          >
            发送
          </button>
        </div>
      </div>
    </>
  );
}
async function downloadPoster(post: Post, toast: (text: string) => void) {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#f5f7f2';
  context.fillRect(0, 0, 1080, 1350);
  context.fillStyle = '#24665e';
  context.fillRect(0, 0, 1080, 16);
  context.font = 'bold 64px sans-serif';
  context.fillText('umeet.', 80, 130);
  function lines(text: string, top: number, font: string, height: number, max: number) {
    context!.font = font;
    const rows = [''];
    for (const char of text) {
      const index = rows.length - 1;
      if (char === '\n' || context!.measureText(rows[index] + char).width > 920) {
        if (rows.length === max) {
          rows[index] = rows[index].slice(0, -1) + '…';
          break;
        }
        rows.push(char === '\n' ? '' : char);
      } else rows[index] += char;
    }
    rows.forEach((line, index) => context!.fillText(line, 80, top + index * height));
  }
  lines(boards.find((board) => board.slug === post.community)!.name, 195, '28px sans-serif', 36, 1);
  context.fillStyle = '#203c37';
  lines(post.title, 310, 'bold 52px sans-serif', 76, 4);
  context.fillStyle = '#49605a';
  lines(post.body, 670, '34px sans-serif', 56, 6);
  context.fillStyle = '#24665e';
  lines('在 Umeet 查看帖子与回复', 1170, '28px sans-serif', 40, 1);
  lines(location.origin + '/' + postHref(post), 1230, '22px sans-serif', 32, 2);
  canvas.toBlob((blob) => {
    if (!blob) return toast('海报生成失败');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'umeet-' + post.id + '.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('分享海报已生成');
  });
}
