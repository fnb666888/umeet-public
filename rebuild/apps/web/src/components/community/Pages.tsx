'use client';
import { navigateCommunity } from '../../lib/community-route';
import { useEffect, useState } from 'react';
import { useCommunity } from './store';
import { Icon } from './Icon';
import { FeedCard, PostList, ViewControls, sortPosts } from './Posts';
import { WikiIndex } from './Wiki';
import { communitySlug } from '../../../../../packages/contracts/src/boards';
import { MarketRules } from './Composer';
import { boardGuides, boards, postHref, searchHref, type Board, type Snapshot } from './model';
import { NewsList, ForecastList } from '../interest/Discover';
import { isContentBoard } from '../../../../../packages/contracts/src/interest';
import { RecommendationList } from '../interest/Preferences';
import { FeedContinuation } from './FeedContinuation';

export function Home({ params }: { params: URLSearchParams }) {
  const { data, sort, setSort, loadMore, moreLoading } = useCommunity();
  const board = params.get('board') || '',
    tag = params.get('tag') || '';
  const tags = [...new Set(data!.content.posts.flatMap((post) => post.tags || []))].sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
  const following = sort === 'following';
  const posts = data!.content.posts.filter(
    (post) =>
      (!following ||
        data!.userState.followedBoards?.includes(post.community) ||
        data!.userState.follows?.includes(post.id) ||
        post.tags?.some((tag) => data!.userState.tagFollows?.includes(tag))) &&
      (!board || post.community === board) &&
      (!tag || post.tags?.includes(tag)),
  );
  const list = data?.partial ? posts : sortPosts(posts, following ? 'activity' : sort, data!);
  function filter(board: string, tag: string) {
    const query = new URLSearchParams();
    if (board) query.set('board', board);
    if (tag) query.set('tag', tag);
    navigateCommunity('#/' + (query.size ? '?' + query : ''));
  }
  return (
    <>
      <header className="forum-heading">
        <h1>首页</h1>
        <a href="/knowledge" className="forum-wiki-link">
          <Icon name="book-open" /> Wiki
        </a>
      </header>
      <div className="forum-toolbar">
        <div className="home-controls">
          <div className="tabs home-order" role="group" aria-label="首页帖子排序">
            {[
              ['hot', '热门'],
              ['latest', '最新'],
              ['following', '我关注的'],
              ['recommended', '推荐'],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={sort === value ? 'on' : ''}
                data-sort={value}
                aria-pressed={sort === value}
                onClick={() => setSort(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <ViewControls />
        </div>
      </div>
      <div className="feed-filters" role="group" aria-label="筛选帖子">
        <label htmlFor="feed-board">
          板块
          <select
            id="feed-board"
            value={board}
            onChange={(event) => filter(event.target.value, tag)}
          >
            <option value="">不限板块</option>
            {boards.map((board) => (
              <option key={board.slug} value={board.slug}>
                {board.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="feed-tag">
          标签
          <select id="feed-tag" value={tag} onChange={(event) => filter(board, event.target.value)}>
            <option value="">不限标签</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        {(board || tag) && (
          <button className="clear-feed-filters" onClick={() => filter('', '')}>
            清除筛选
          </button>
        )}
        <span className="filter-count" role="status">
          {list.length} 个话题
        </span>
      </div>
      <div id="feed">
        {sort === 'recommended' ? (
          <RecommendationList posts={list} />
        ) : !list.length && (board || tag) ? (
          <p className="empty">没有符合当前筛选的话题，试试其他板块或标签。</p>
        ) : following && !list.length ? (
          <p className="empty">订阅板块，或关注感兴趣的帖子和标签，它们的更新会出现在这里。</p>
        ) : (
          <PostList posts={list} />
        )}
        {data?.partial && data.page?.next ? <FeedContinuation />
          : list.length > 0 && <p className="feed-end">{data?.bootstrap ? '正在同步最新内容…' : '已显示全部话题'}</p>}
      </div>
    </>
  );
}
export function Discover({ params = new URLSearchParams() }: { params?: URLSearchParams } = {}) {
  const { data, siteSettings } = useCommunity();
  const legacyTab = params.get('tab');
  const legacyQuery = new URLSearchParams(params);
  legacyQuery.delete('tab');
  const legacyHref =
    legacyTab && isContentBoard(legacyTab)
      ? '/#/c/' + legacyTab + (legacyQuery.size ? '?' + legacyQuery : '')
      : '';
  useEffect(() => {
    if (legacyHref) location.replace(legacyHref);
  }, [legacyHref]);
  if (legacyHref)
    return (
      <p role="status">
        正在打开板块… <a href={legacyHref}>打开板块</a>
      </p>
    );
  return (
    <>
      <header className="section-heading discover-heading">
        <h1>发现</h1>
        <a className="btn-primary discover-apply" href="#/apply-board">
          <Icon name="plus" />
          申请开设板块
        </a>
      </header>

      <div className="discover-grid">
        {boards.map((board) => {
          const posts = data!.content.posts.filter((post) => post.community === board.slug);
          const summary =
            board.slug === 'news'
              ? '资讯自动更新'
              : board.slug === 'forecasts'
                ? '每日预测与复盘'
                : board.slug === 'questions'
                  ? '待解答 ' +
                    posts.filter((post) => !data!.userState.best[post.id]).length +
                    ' 条'
                  : board.slug === 'market'
                    ? '在售 ' + posts.filter((post) => !post.sold).length + ' 件'
                    : board.slug === 'buddies'
                      ? '近 7 天活动 ' +
                        posts.filter(
                          (post) =>
                            post.meetingAt &&
                            post.meetingAt >= Date.now() &&
                            post.meetingAt <= Date.now() + 7 * 86400000,
                        ).length +
                        ' 场'
                      : '话题 ' + posts.length + ' 条';
          return (
            <a className="card d-card" href={'#/c/' + board.slug} key={board.slug}>
              <span className="board-mark">
                <Icon name={board.icon} />
              </span>
              <h2>{board.name}</h2>
              <p>{siteSettings?.boards[board.slug]?.description || board.desc}</p>
              <div className="stat">
                <span>{data?.bootstrap ? '浏览板块' : summary}</span>
                <span>
                  {isContentBoard(board.slug) ? (
                    '可订阅到侧栏'
                  ) : (
                    <>
                      {
                        data!.content.wiki.filter((wiki) => wiki.communities.includes(board.slug))
                          .length
                      }{' '}
                      篇词条
                    </>
                  )}
                </span>
              </div>
              <span className="go" aria-hidden="true">
                <Icon name="arrow-up-right" />
              </span>
            </a>
          );
        })}
      </div>
    </>
  );
}
export function Community({
  slug,
  section,
  params = new URLSearchParams(),
}: {
  slug: string;
  section?: string;
  params?: URLSearchParams;
}) {
  const { data, siteSettings, busy, toggleState, compose, loadMore, moreLoading } = useCommunity();
  const sort=params.get('sort')==='latest'?'latest':'activity';
  const [query, setQuery] = useState('');
  const board = boards.find((board) => board.slug === slug);
  if (!board)
    return (
      <div className="empty">
        没有找到这个板块。<a href="#/discover">查看所有板块</a>
      </div>
    );
  const tab = section === 'wiki' || (slug === 'market' && section === 'rules') ? section : 'feed',
    base = '#/c/' + slug;
  const subscribed = data!.userState.followedBoards?.includes(slug) || false;
  const boardSettings = siteSettings?.boards[board.slug];
  const rules = boardSettings?.rules || boardGuides[board.slug] || [];
  return (
    <>
      <a className="back" href="#/">
        ← 返回首页
      </a>
      <div className="page-head community-head">
        <div>
          <h1>
            {board.name}
            {tab === 'wiki' ? ' Wiki' : ''}
          </h1>
          <p className="muted">{boardSettings?.description || board.desc}</p>
        </div>
        <div className="board-actions">
          {data?.actor?.moderation?.boards.some((item) => item.board === slug) && (
            <a
              className="forum-wiki-link"
              href={
                (data.actor.moderation.admin ? '/admin' : '/moderation') +
                '?board=' +
                slug +
                (isContentBoard(slug) ? '&view=interest' : '')
              }
            >
              管理社区
            </a>
          )}
          <a
            className="forum-wiki-link"
            href={tab === 'wiki' ? base : '/c/' + communitySlug(slug) + '/knowledge'}
          >
            <Icon name={tab === 'wiki' ? 'messages-square' : 'book-open'} />{' '}
            {tab === 'wiki' ? '返回帖子' : '板块 Wiki'}
          </a>
          <button
            className="link-btn"
            id="subscribe-board"
            aria-pressed={subscribed}
            disabled={busy}
            onClick={() => void toggleState('followedBoards', slug)}
          >
            {subscribed ? '取消订阅' : '订阅板块'}
          </button>
          {!isContentBoard(slug) && (
            <button
              className="btn-primary board-compose"
              disabled={boardSettings?.posting?.readonly}
              onClick={() => compose(slug as Board)}
            >
              <Icon name="plus" /> {boardSettings?.posting?.readonly ? '暂停发帖' : '发帖'}
            </button>
          )}
        </div>
      </div>
      {tab === 'feed' && rules.length > 0 && (
        <details className="board-public-rules">
          <summary>板块规则</summary>
          <ul>
            {rules.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      {tab === 'wiki' ? (
        <WikiIndex key={slug} board={slug} />
      ) : slug === 'news' ? (
        <NewsList params={params} />
      ) : slug === 'forecasts' ? (
        <ForecastList params={params} />
      ) : tab === 'rules' ? (
        <MarketRules />
      ) : (
        <>
          <form
            id="board-search"
            className="board-search"
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim()) navigateCommunity(searchHref(query.trim(), 'all', slug));
            }}
          >
            <label className="sr-only" htmlFor="board-search-q">
              搜本板块
            </label>
            <input
              id="board-search-q"
              type="search"
              placeholder="搜本板块"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="link-btn">搜索</button>
          </form>
          <div className="community-toolbar">
            <label className="board-sort">
              <span className="sr-only">板块排序</span>
              <select
                id="board-sort"
                value={sort}
                onChange={(event) => navigateCommunity(base+'?'+new URLSearchParams({sort:event.target.value}))}
              >
                <option value="activity">最近回复</option>
                <option value="latest">最新发布</option>
              </select>
            </label>
            <ViewControls className="community-view" />
          </div>
          <div id="c-feed">
            <PostList
              posts={data?.partial ? data.content.posts.filter(post=>post.community===slug) : sortPosts(
                data!.content.posts.filter((post) => post.community === slug),
                sort,
                data!,
              )}
            />
            {data?.partial&&data.page?.next&&<FeedContinuation />}
          </div>
        </>
      )}
    </>
  );
}
export function TagPage({ tag }: { tag: string }) {
  const { data, busy, toggleState } = useCommunity();
  const active = data!.userState.tagFollows?.includes(tag) || false;
  const posts = sortPosts(
    data!.content.posts.filter((post) => post.tags?.includes(tag)),
    'hot',
    data!,
  );
  return (
    <>
      <a className="back" href="#/">
        ← 返回首页
      </a>
      <div className="card tag-head">
        <div>
          <h1>{tag}</h1>
          <p className="m">{posts.length} 个帖子 · 标签聚合页</p>
        </div>
        <button
          className="btn-ghost"
          id="follow-tag"
          data-tagfollow={tag}
          aria-pressed={active}
          disabled={busy}
          onClick={() => void toggleState('tagFollows', tag)}
        >
          <Icon name="bell" /> {active ? '已关注' : '关注此标签'}
        </button>
      </div>
      <div id="feed">
        <PostList posts={posts} />
      </div>
    </>
  );
}
export type SearchHit = { href: string; title: string; label: string; type: string };
export function searchHits(data: Snapshot, query: string, board = ''): SearchHit[] {
  const key = query.replace(/^#\s*/, '').trim().toLowerCase();
  if (!key) return [];
  const posts = data.content.posts.filter(
    (post) =>
      (!board || post.community === board) &&
      [
        post.title,
        post.body,
        post.meeting,
        ...(post.tags || []),
        ...Object.values(post.project || {}),
        ...(post.updates || []).map((update) => update.body),
        post.project ? '校园作品' : '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(key),
  );
  const wiki = data.content.wiki.filter(
    (wiki) =>
      (!board || wiki.communities.includes(board as Board)) &&
      [wiki.title, wiki.summary, ...wiki.sections.map((section) => section.h + ' ' + section.p)]
        .join(' ')
        .toLowerCase()
        .includes(key),
  );
  const tags = [
    ...new Set(
      data.content.posts
        .filter((post) => !board || post.community === board)
        .flatMap((post) => post.tags || []),
    ),
  ].filter((tag) => tag.toLowerCase().includes(key));
  return [
    ...posts.map((post) => ({
      href: postHref(post),
      title: post.title,
      label: '帖子 · ' + boards.find((board) => board.slug === post.community)!.name,
      type: 'posts',
    })),
    ...wiki.map((wiki) => ({
      href: '#/wiki/' + wiki.id,
      title: wiki.title,
      label: 'Wiki · ' + wiki.summary,
      type: 'wiki',
    })),
    ...tags.map((tag) => ({
      href: '#/tag/' + encodeURIComponent(tag),
      title: '#' + tag,
      label: '标签',
      type: 'tags',
    })),
  ];
}
export function SearchPage({ params }: { params: URLSearchParams }) {
  const { data } = useCommunity();
  const query = (params.get('q') || '').trim(),
    board = boards.find((board) => board.slug === params.get('board'));
  const type = params.get('type') || 'all';
  const hits = searchHits(data!, query, board?.slug).filter(
    (hit) => type === 'all' || hit.type === type,
  );
  return (
    <>
      <div className="page-head">
        <h1>搜索结果</h1>
      </div>
      <p className="result-summary">
        {query ? '「' + query + '」 · ' + hits.length + ' 条结果' : '在顶栏输入关键词搜索。'}
      </p>
      {board && (
        <p className="search-scope">
          <span>范围 · {board.name}</span>
          <a className="link-btn" href={searchHref(query, type)}>
            搜索全站
          </a>
        </p>
      )}
      <nav className="tabs community-tabs" aria-label="搜索结果分类">
        {[
          ['all', '全部'],
          ['posts', '帖子'],
          ['wiki', 'Wiki'],
          ['tags', '标签'],
        ].map(([key, label]) => (
          <a
            key={key}
            href={searchHref(query, key, board?.slug)}
            aria-current={key === type ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      {hits.length ? (
        <div className="card search-results">
          {hits.map((hit) => (
            <a key={hit.href} href={hit.href}>
              <b>{hit.title}</b>
              <small>{hit.label}</small>
            </a>
          ))}
        </div>
      ) : (
        <p className="empty">没有匹配的结果，试试其他关键词或分类。</p>
      )}
    </>
  );
}
export function Bookmarks() {
  const { data } = useCommunity();
  const posts = [...(data!.userState.bookmarks || [])]
    .reverse()
    .map((id) => data!.content.posts.find((post) => post.id === id))
    .filter((post) => post !== undefined);
  return (
    <>
      <div className="page-head">
        <h1>收藏</h1>
      </div>
      <p className="result-summary">你收藏的内容，方便随时回来查看。共 {posts.length} 条。</p>
      <div className="interest-actions">
        <a href="#/c/news?saved=true">收藏的资讯</a>
        <a href="#/c/forecasts?saved=true">收藏的预测</a>
      </div>
      {posts.length ? (
        posts.map((post) => <FeedCard key={post.id} post={post} />)
      ) : (
        <div className="empty">
          还没有收藏的内容。看到想留着的帖子，点击收藏就会出现在这里。
          <p>
            <a href="#/">去首页看看</a>
          </p>
        </div>
      )}
    </>
  );
}
