'use client';
import { SiteLink as Link } from '../SiteLink';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { accountState } from '../../lib/browser-session';
import { DemoAuthDialog, switchAccount } from '../DemoAuthDialog';
import { CommunityProvider, useCommunity } from './store';
import { Icon } from './Icon';
import { Composer } from './Composer';
import { PostPage, sortPosts } from './Posts';
import { WikiArticle } from './Wiki';
import { Bookmarks, Community, Discover, Home, SearchPage, TagPage, searchHits } from './Pages';
import { Inbox } from './Inbox';
import { MessagingProvider, useMessages } from './messaging';
import './messaging.css';
import './governance.css';
import { Profile, Settings, logout } from './Profile';
import { CommunityApplications } from './CommunityApplications';
import { GovernanceCenter } from './Governance';
import { age, boards, parseRoute, postHref, replyHref, searchHref, type Snapshot } from './model';
import { communitySlug } from '../../../../../packages/contracts/src/boards';
import { ArtifactDetail } from '../interest/ArtifactDetail';
import { InterestOnboarding } from '../interest/Preferences';
import '../interest/interest.css';
import { prepareRoute } from '../../lib/route-resources';

export function CommunityApplication({ children, initialData }: { children?: ReactNode; initialData?: Snapshot | null }) {
  return (
    <CommunityProvider initialData={initialData}>
      <MessagingProvider>
        <Application>{children}</Application>
      </MessagingProvider>
    </CommunityProvider>
  );
}
function MemberPage({ children }: { children: ReactNode }) {
  const { data, requireLogin } = useCommunity();
  const member = data!.actor?.kind === 'member';
  useEffect(() => {
    if (!member) requireLogin();
  }, [member]);
  return member ? (
    children
  ) : (
    <div className="empty">
      <p>请先使用邮箱登录</p>
      <button className="btn-primary" onClick={requireLogin}>
        邮箱登录 / 注册
      </button>
    </div>
  );
}
function WikiRedirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return (
    <p role="status">
      正在打开 Wiki… <Link href={href}>打开 Wiki</Link>
    </p>
  );
}
function Page() {
  const { hash } = useCommunity();
  const { parts, params, anchor } = parseRoute(hash);
  switch (parts[0]) {
    case undefined:
      return <Home params={params} />;
    case 'my-applications':
      return (
        <MemberPage>
          <CommunityApplications />
        </MemberPage>
      );
    case 'apply-board':
      return (
        <MemberPage>
          <CommunityApplications kind="board" />
        </MemberPage>
      );
    case 'apply-moderator':
    case 'apply-assistant':
      return (
        <MemberPage>
          <section className="governance-page">
            <h1>管理人员邀请</h1>
            <p>版主和助手由管理人员邀请加入。</p>
            <Link href="#/my-applications">查看我的邀请</Link>
          </section>
        </MemberPage>
      );
    case 'discover':
      return <Discover params={params} />;
    case 'news':
      return <ArtifactDetail key={parts[1]} kind="news" id={parts[1] || ''} />;
    case 'forecasts':
      return <ArtifactDetail key={parts[1]} kind="forecast" id={parts[1] || ''} />;
    case 'c':
      if (parts[2] === 'wiki')
        return <WikiRedirect href={'/c/' + communitySlug(parts[1] || '') + '/knowledge'} />;
      return <Community key={parts[1]} slug={parts[1]} section={parts[2]} params={params} />;
    case 'posts':
      return (
        <PostPage key={parts[1]} id={parts[1]} thread={params.get('thread')} anchor={anchor} />
      );
    case 'wiki':
      return parts[1] ? (
        <WikiArticle key={parts[1]} id={parts[1]} anchor={anchor} />
      ) : (
        <WikiRedirect href="/knowledge" />
      );
    case 'search':
      return <SearchPage params={params} />;
    case 'tag':
      return <TagPage key={parts[1]} tag={parts[1]} />;
    case 'me':
      return (
        <MemberPage>
          <Profile />
        </MemberPage>
      );
    case 'users':
      return <Profile key={parts[1]} id={parts[1]} />;
    case 'settings':
      return (
        <MemberPage>
          <Settings key={parts[1]} initialTab={parts[1] || 'account'} />
        </MemberPage>
      );
    case 'bookmarks':
    case 'recommended':
      return (
        <MemberPage>
          <Bookmarks />
        </MemberPage>
      );
    case 'inbox':
      return (
        <MemberPage>
          <Inbox peer={parts[1]} params={params} />
        </MemberPage>
      );
    default:
      return <Home params={params} />;
  }
}
export function CommunityView({ children }: { children?: ReactNode }) { return <Application>{children}</Application>; }
function Application({ children }: { children?: ReactNode }) {
  const {
    data,
    ready,
    siteSettings,
    error,
    refresh,
    hash,
    compose,
    message,
    requireLogin,
    mutate,
    busy,
    toast,
  } = useCommunity();
  const { summary: messageSummary } = useMessages();
  useEffect(() => {
    if (!data || data.bootstrap) return;
    const timer = setTimeout(() => {
      for (const href of ['/knowledge', '/community/c/news', '/community/c/forecasts']) prepareRoute(href, 0);
      if (data.actor?.platformRoles?.some(role => role === 'owner' || role === 'admin')) {
        prepareRoute('/admin', 0);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [data?.actor?.userId, data?.bootstrap]);
  useEffect(() => {
    if (data?.actor?.kind === 'member' && sessionStorage.getItem('umeet-account-switched')) {
      sessionStorage.removeItem('umeet-account-switched');
      toast('已切换到 ' + (data.userState.profile?.name || data.actor.nickname));
    }
  }, [data?.actor?.userId, toast]);
  const [menu, setMenu] = useState(false);
  const [drop, setDrop] = useState('');
  const [personalNotices,setPersonalNotices]=useState<Snapshot['content']['notifications']|null>(null);
  useEffect(()=>{
    if(!data?.partial||drop!=='bell')return;
    const controller=new AbortController();
    void fetch('/api/backend/demo/pages/feed?notices=1',{cache:'no-store',signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error();return response.json();})
      .then(snapshot=>setPersonalNotices(snapshot.content.notifications))
      .catch(()=>{if(!controller.signal.aborted)toast('通知读取失败，请稍后重试');});
    return ()=>controller.abort();
  },[drop,data?.partial,data?.actor?.userId,toast]);
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState(0);
  const { parts, params } = parseRoute(hash);
  const externalContent = children !== undefined;
  const searchTarget = externalContent
    ? '/knowledge?q=' + encodeURIComponent(query.trim())
    : '/' + searchHref(query.trim());
  useEffect(() => {
    if (externalContent) setQuery(new URLSearchParams(location.search).get('q') || '');
  }, [externalContent]);
  const page = externalContent ? 'wiki' : parts[0];
  const site = siteSettings?.site;
  const siteTitle = site?.title || 'Umeet';
  const activeAnnouncements = siteSettings?.announcements.filter((item) =>
    !page ? !item.boards.length : page === 'c' && item.boards.some((board) => board === parts[1]),
  );
  const path = hash.split('?')[0];
  const positions = useRef(new Map<string, number>());
  const position = useRef(0);
  const previous = useRef('');
  useEffect(() => {
    setMenu(false);
    setDrop('');
    if (page === 'search') setQuery(params.get('q') || '');
    document.body.classList.toggle(
      'wiki-page',
      page === 'wiki' || (page === 'c' && parts[2] === 'wiki'),
    );
    if (previous.current) positions.current.set(previous.current, position.current);
    previous.current = hash;
    if (page !== 'posts' && !parseRoute(hash).anchor)
      requestAnimationFrame(() =>
        window.scrollTo({ top: positions.current.get(hash) || 0, behavior: 'instant' }),
      );
    return () => document.body.classList.remove('wiki-page');
  }, [hash]);
  useEffect(() => {
    const original = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const scroll = () => {
      position.current = window.scrollY;
      const root = document.documentElement;
      setProgress(
        root.scrollHeight > root.clientHeight
          ? (100 * root.scrollTop) / (root.scrollHeight - root.clientHeight)
          : 0,
      );
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => {
      history.scrollRestoration = original;
      window.removeEventListener('scroll', scroll);
    };
  }, []);
  useEffect(()=>{
    if(ready&&page!=='posts'&&!parseRoute(hash).anchor)
      requestAnimationFrame(()=>window.scrollTo({top:positions.current.get(hash)||0,behavior:'instant'}));
  },[ready,hash]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('.bell-wrap,.avatar-wrap,#search')
      )
        setDrop('');
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrop('');
        setMenu(false);
      }
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const profile = data?.userState.profile,
    name = profile?.name || data?.actor?.nickname || '游客';
  const announcements =
    data?.actor?.kind === 'member' && data.userState.notifPrefs?.system
      ? (siteSettings?.announcements || []).map((item) => ({
          id: 'announcement-' + item.id,
          text: '校园公告 · ' + item.title,
          detail: item.body,
          href: item.boards[0] ? '#/c/' + item.boards[0] : '#/',
          createdAt: item.startsAt ? Date.parse(item.startsAt) : 0,
        }))
      : [];
  const notices = [...announcements, ...(personalNotices||data?.content.notifications || [])],
    read = data?.userState.readNotifications || [],
    unread = notices.filter((notice) => !read.includes(notice.id)).length;
  const hits = data && !externalContent ? searchHits(data, query) : [];
  function nav(href: string, label: string, icon: string, unread = false) {
    const active =
      href === '/knowledge'
        ? page === 'wiki'
        : !externalContent && (path === href || (href !== '#/' && path.startsWith(href + '/')));
    return (
      <Link
        key={href}
        href={href.startsWith('#/') ? '/' + href : href}
        className={active ? 'on' : ''}
        aria-current={active ? 'page' : undefined}
      >
        <Icon name={icon} />
        <span>{label}</span>
        {unread && <span className="unread-dot" aria-label="有未读私信" />}
      </Link>
    );
  }
  const subscriptions = boards.filter((board) =>
    data?.userState.followedBoards?.includes(board.slug),
  );
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <button
            className="menu-btn"
            id="menu-btn"
            aria-label="菜单"
            aria-controls="sidebar"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Icon name="menu" />
          </button>
          <Link className="brand" href="/#/" aria-label={siteTitle + ' 首页'}>
            {site?.logo ? (
              <img
                className="configured-brand-logo"
                src={site.logo}
                alt={siteTitle}
                referrerPolicy="no-referrer"
              />
            ) : siteTitle !== 'Umeet' ? (
              <span className="configured-brand-name">{siteTitle}</span>
            ) : (
              <>
                <span className="brand-initial">u</span>
                <span>meet</span>
                <span className="brand-dot">.</span>
              </>
            )}
          </Link>
          <div className="search" id="search">
            <Icon name="search" />
            <input
              id="search-input"
              aria-label="搜索帖子、词条或标签"
              placeholder="搜索校园内容"
              autoComplete="off"
              value={query}
              onFocus={() => {
                if (query.trim()) setDrop('search');
              }}
              onChange={(event) => {
                setQuery(event.target.value);
                setDrop('search');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && query.trim()) {
                  location.href = searchTarget;
                  setDrop('');
                }
              }}
            />
            <div
              className="search-drop"
              id="search-drop"
              hidden={drop !== 'search' || !query.trim()}
            >
              {hits.slice(0, 9).map((hit) => (
                <Link className="hit" href={'/' + hit.href} key={hit.href} onClick={() => setDrop('')}>
                  <b>{hit.title}</b>
                  <small>{hit.label}</small>
                </Link>
              ))}
              {!hits.length && (
                <p className="search-hint">
                  {externalContent ? '按 Enter 搜索 Wiki 词条' : '未找到匹配内容'}
                </p>
              )}
              <Link className="hit search-all" href={searchTarget} onClick={() => setDrop('')}>
                搜索「{query.trim()}」
              </Link>
            </div>
          </div>
          <div className="top-actions">
            <button className="btn-primary" id="btn-new" onClick={() => compose()}>
              发帖
            </button>
            <div className="bell-wrap">
              <button
                className="bell"
                id="btn-bell"
                aria-label="通知"
                aria-expanded={drop === 'bell'}
                onClick={() => setDrop(drop === 'bell' ? '' : 'bell')}
              >
                <Icon name="bell" />
                <span className="badge" id="bell-badge" hidden={!unread}>
                  {unread}
                </span>
              </button>
              <div className="drop" id="bell-drop" hidden={drop !== 'bell'}>
                <div className="drop-head">
                  <b>通知</b>
                  {unread > 0 && (
                    <button
                      id="bell-read"
                      disabled={busy}
                      onClick={() =>
                        void mutate([
                          {
                            type: 'state.save',
                            state: {
                              readNotifications: [
                                ...new Set([...read, ...notices.map((notice) => notice.id)]),
                              ].slice(-1000),
                            },
                          },
                        ])
                      }
                    >
                      全部已读
                    </button>
                  )}
                </div>
                {!notices.length && (
                  <div className="notification-empty" role="status">
                    {error ? (
                      <>
                        <p>通知暂时无法加载</p>
                        <button type="button" onClick={() => void refresh()}>
                          重试
                        </button>
                      </>
                    ) : !data ? (
                      '正在加载通知…'
                    ) : (
                      '暂无通知，有新动态时会在这里提醒你。'
                    )}
                  </div>
                )}
                {notices.map((notice) => (
                  <Link
                    className={'n ' + (read.includes(notice.id) ? '' : 'unread')}
                    href={notice.href.startsWith('#/') ? '/' + notice.href : notice.href}
                    key={notice.id}
                    onClick={() => {
                      if (!read.includes(notice.id))
                        void mutate([
                          {
                            type: 'state.save',
                            state: { readNotifications: [...read, notice.id].slice(-1000) },
                          },
                        ]);
                      setDrop('');
                    }}
                  >
                    <span
                      className={'dot ' + (read.includes(notice.id) ? 'read' : '')}
                      aria-hidden="true"
                    />
                    <span className="n-body">
                      {notice.text}
                      <br />
                      <small>
                        {notice.detail}
                        {notice.createdAt ? ' · ' + age(notice) : ''}
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="avatar-wrap">
              <button
                className="avatar"
                id="btn-avatar"
                aria-label="我的账号"
                aria-expanded={drop === 'avatar'}
                onClick={() => setDrop(drop === 'avatar' ? '' : 'avatar')}
              >
                {profile?.avatar ? <img src={profile.avatar} alt="" /> : Array.from(name)[0]}
              </button>
              <div className="drop" id="avatar-drop" hidden={drop !== 'avatar'}>
                <div className="drop-head">
                  <b>{name}</b>
                  <span className="muted" style={{ fontSize: 12 }}>
                    <Icon name="check" /> {data?.actor?.kind === 'member' ? '正式账号' : '游客'}
                  </span>
                </div>
                {data?.actor?.kind !== 'member' && (
                  <button
                    className="n"
                    id="login"
                    onClick={() => {
                      setDrop('');
                      requireLogin();
                    }}
                  >
                    <span className="n-body">
                      <Icon name="user" /> 邮箱登录 / 注册
                    </span>
                  </button>
                )}
                {[
                  ['#/me', '个人主页', 'user'],
                  ['#/inbox', '私信', 'inbox'],
                  ['#/discover', '发现', 'compass'],
                  ['#/settings', '设置', 'settings'],
                ].map(([href, label, icon]) => (
                  <Link className="n" href={'/' + href} key={href} onClick={() => setDrop('')}>
                    <span className="n-body">
                      <Icon name={icon} /> {label}
                    </span>
                  </Link>
                ))}
                {(data?.actor?.kind === 'member' || !!accountState()?.accounts.length) && (
                  <button
                    className="n"
                    id="switch-account"
                    onClick={() => {
                      setDrop('');
                      switchAccount();
                    }}
                  >
                    <span className="n-body">
                      <Icon name="switch-account" /> 切换账号
                    </span>
                  </button>
                )}
                {data?.actor?.kind === 'member' && (
                  <button
                    className="n"
                    id="logout"
                    onClick={() => void logout().catch((error) => toast(error.message))}
                  >
                    <span className="n-body">
                      <Icon name="log-out" /> 退出登录
                    </span>
                  </button>
                )}
                {data?.actor?.platformRoles?.some(
                  (role) => role === 'owner' || role === 'admin',
                ) && (
                  <Link className="n" href="/admin">
                    <span className="n-body">
                      <Icon name="settings" />
                      全站后台
                    </span>
                  </Link>
                )}
                {!data?.actor?.moderation?.admin && !!data?.actor?.moderation?.boards.length && (
                  <Link className="n" href="/moderation">
                    <span className="n-body">
                      <Icon name="settings" />
                      社区工作台
                    </span>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>
      <div className="layout">
        <aside className={'sidebar ' + (menu ? 'open' : '')} id="sidebar">
          <nav aria-label="主导航">
            <div className="sec">社区</div>
            {nav('#/', '首页', 'house')}
            {nav('#/discover', '发现', 'compass')}
            {nav('#/bookmarks', '收藏', 'bookmark')}
            {nav('/knowledge', 'Wiki', 'book-open')}
            <div className="sec">订阅板块</div>
            {subscriptions.length ? (
              subscriptions.map((board) => {
                const href = '#/c/' + board.slug,
                  active = path === href || path.startsWith(href + '/'),
                  count = data!.content.posts.filter(
                    (post) =>
                      post.community === board.slug &&
                      post.createdAt >= new Date().setHours(0, 0, 0, 0),
                  ).length;
                return (
                  <Link
                    className={'c-row ' + (active ? 'on' : '')}
                    href={'/' + href}
                    key={board.slug}
                    aria-current={active ? 'page' : undefined}
                  >
                    <b>
                      <Icon name={board.icon} />
                      {board.name}
                    </b>
                    {count > 0 && (
                      <span className="n" aria-label={'今日 ' + count + ' 帖'}>
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })
            ) : (
              <p className="sidebar-empty">还没有订阅板块</p>
            )}
            <div className="sec">我的</div>
            {nav(
              '#/inbox',
              '私信',
              'inbox',
              messageSummary.unread > 0 || messageSummary.requests > 0,
            )}
            {nav('#/me', '个人主页', 'user')}
          </nav>
        </aside>
        <main className="main" id="main" aria-busy={Boolean(data?.bootstrap && !externalContent)}>
          {!data?.suspended && (
            <>
              {!page && (site?.description || site?.feedback) && (
                <section className="site-intro" aria-label="站点介绍">
                  {site.description && <p>{site.description}</p>}
                  {site.feedback && (
                    <a href={site.feedback} target="_blank" rel="noreferrer">
                      意见反馈
                    </a>
                  )}
                </section>
              )}
              {activeAnnouncements?.map((item) => (
                <section key={item.id} className="site-announcement" aria-label="社区公告">
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </section>
              ))}
            </>
          )}
          {error && (
            <div className="empty" role="alert">
              <p>{error}</p>
              <button className="btn-primary" onClick={() => void refresh()}>
                重新加载
              </button>
            </div>
          )}
          {data?.actor?.kind === 'member' && !externalContent && (!page || page === 'discover') && (
            <InterestOnboarding allowEdit={page === 'discover'} />
          )}
          {data?.suspended ? (
            <GovernanceCenter />
          ) : externalContent ? (
            children
          ) : data && ready !== false && (!data.bootstrap || !page || page === 'discover') ? (
            <Page />
          ) : (
            !error && <p role="status">正在加载社区…</p>
          )}
        </main>
        <aside className={'rail ' + (!page ? 'home-rail' : '')} id="rail">
          {data && !externalContent && <Rail />}
        </aside>
      </div>
      <Composer />
      <div className="toast" id="toast" role="status" hidden={!message}>
        {message}
      </div>
      <div
        id="progress"
        style={{ display: page === 'posts' ? 'block' : 'none', width: progress + '%' }}
      />
      <DemoAuthDialog registrationMode={siteSettings?.registration?.mode} currentAccount={name} />
    </>
  );
}
function Rail() {
  const { data, hash, sort } = useCommunity();
  const { parts } = parseRoute(hash);
  const page = parts[0];
  if (
    [
      'wiki',
      'posts',
      'inbox',
      'settings',
      'users',
      'me',
      'bookmarks',
      'recommended',
      'search',
      'news',
      'forecasts',
    ].includes(page) ||
    (page === 'c' && parts[2] === 'wiki')
  )
    return null;
  const board = page === 'c' ? boards.find((board) => board.slug === parts[1]) : undefined;
  const posts = board
      ? data!.content.posts.filter((post) => post.community === board.slug)
      : data!.content.posts,
    top = sortPosts(posts, 'hot', data!).slice(0, 3),
    wiki = board
      ? data!.content.wiki.filter((wiki) => wiki.communities.includes(board.slug))
      : data!.content.wiki;
  if (board)
    return (
      <>
        {wiki.length > 0 && (
          <section className="panel">
            <h3>板块 Wiki</h3>
            {wiki.slice(0, 3).map((wiki) => (
              <div className="row" key={wiki.id}>
                <Link href={'#/wiki/' + wiki.id}>{wiki.title}</Link>
              </div>
            ))}
          </section>
        )}
        {top.length > 0 && (
          <section className="panel">
            <h3>板块讨论</h3>
            {top.map((post) => (
              <div className="row" key={post.id}>
                <Link href={postHref(post)}>{post.title}</Link>
              </div>
            ))}
          </section>
        )}
      </>
    );
  const counts = new Map<string, number>();
  posts
    .flatMap((post) => post.tags || [])
    .forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const daily = posts
    .filter(
      (post) =>
        post.community === 'daily' &&
        (sort !== 'following' ||
          data!.userState.followedBoards?.includes(post.community) ||
          data!.userState.follows?.includes(post.id) ||
          post.tags?.some((tag) => data!.userState.tagFollows?.includes(tag))),
    )
    .flatMap((post) => (data!.content.comments[post.id] || []).map((reply) => ({ post, reply })))
    .sort((a, b) => b.reply.createdAt - a.reply.createdAt)
    .slice(0, 3);
  return (
    <>
      <section className="panel rail-wiki">
        <div className="rail-section-head">
          <h3>
            <Icon name="book-open" /> Wiki
          </h3>
          <Link href="/knowledge">
            全部词条 <Icon name="arrow-up-right" />
          </Link>
        </div>
        <ul>
          {wiki.slice(0, 3).map((wiki) => (
            <li key={wiki.id}>
              <Link href={'#/wiki/' + wiki.id}>{wiki.title}</Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel rail-ranking">
        <h3>讨论热榜</h3>
        <ol>
          {top.map((post, index) => (
            <li className="rank-item" key={post.id}>
              <span className="rank-number" aria-hidden="true">
                0{index + 1}
              </span>
              <div>
                <Link href={postHref(post)}>{post.title}</Link>
                <small>
                  <span>{boards.find((board) => board.slug === post.community)!.name}</span>
                  <span data-rail-score={post.id}>
                    {post.likes + Number(data!.userState.likes.includes(post.id))} 赞
                  </span>
                </small>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="panel rail-tags">
        <h3>热门标签</h3>
        <div className="rail-tag-list">
          {tags.map(([tag, count]) => (
            <Link
              key={tag}
              href={'#/tag/' + encodeURIComponent(tag)}
              aria-label={tag + '，' + count + ' 帖'}
            >
              {tag}
            </Link>
          ))}
        </div>
      </section>
      {!page && daily.length > 0 && (
        <section className="card daily-conversation" aria-labelledby="daily-conversation-title">
          <div className="daily-conversation-head">
            <h2 id="daily-conversation-title">大家在聊</h2>
            <Link href="#/c/daily" className="link-btn">
              校园日常
            </Link>
          </div>
          <ul>
            {daily.map(({ post, reply }) => (
              <li key={reply.id}>
                <Link href={replyHref(post, reply)}>
                  <span className="daily-reply-context">
                    <strong>{reply.author}</strong> <time>{age(reply)}</time>
                  </span>
                  <span className="daily-reply-preview">
                    {reply.body || (reply.image ? '图片回复' : '')}
                  </span>
                  <span className="daily-reply-topic">{post.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
