/* umeet 社区 demo —— 交互原型（hash 路由 + mock 数据） */
'use strict';

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeAgo = h => h < 1 ? '刚刚' : h < 24 ? Math.floor(h) + ' 小时前' : Math.round(h / 24) + ' 天前';
const comm = slug => communities.find(c => c.slug === slug);
const heartSvg = uiIcon('heart');
const chatSvg = uiIcon('message-circle');
const EMOJIS = ['😀','😂','🥹','😍','🤔','😭','😅','🙃','😴','🤗','🤝','👍','👎','🙏','👏','💪','🔥','✨','🎉','❤️','🧡','💚','🍀','🌱','📚','✏️','🎒','☕','🍜','🏀','⚽','🚲','🌧️','☀️','🌙','⭐','📷','🎧','💡','📌'];
const COLORS = ['#142d2b','#215d80','#9e3833','#8c4b35','#69553c','#29584b'];

/* ---------- 内容格式：消毒 / MD 互转 ---------- */
function cleanHtml(html){
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(n => n.remove());
  t.content.querySelectorAll('*').forEach(n => {
    [...n.attributes].forEach(a => {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
    });
  });
  return t.innerHTML;
}
function inlineMd(s){
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" rel="nofollow ugc">$1</a>');
}
function mdToHtml(md){
  const lines = esc(md).split(/\r?\n/);
  let html = '', inQuote = false, buf = [];
  const flushP = () => { if (buf.length){ html += '<p>' + inlineMd(buf.join('<br>')) + '</p>'; buf = []; } };
  const closeQ = () => { if (inQuote){ html += '</blockquote>'; inQuote = false; } };
  for (const line of lines){
    let m;
    if ((m = line.match(/^#{1,3}\s+(.*)/))){ flushP(); closeQ(); html += '<h2>' + inlineMd(m[1]) + '</h2>'; }
    else if (/^>\s?/.test(line)){ flushP(); if (!inQuote){ html += '<blockquote>'; inQuote = true; } html += inlineMd(line.replace(/^>\s?/, '')); }
    else if (line.trim() === ''){ flushP(); closeQ(); }
    else { closeQ(); buf.push(line); }
  }
  flushP(); closeQ();
  return html || '<p></p>';
}
function htmlToMd(html){
  const t = document.createElement('template');
  t.innerHTML = html;
  const walk = (node, out) => {
    node.childNodes.forEach(n => {
      if (n.nodeType === 3){ out.push(n.textContent); return; }
      const tag = n.tagName;
      if (tag === 'BR'){ out.push('\n'); return; }
      if (tag === 'H2' || tag === 'H3'){ out.push('\n\n## ' + n.textContent + '\n\n'); return; }
      if (tag === 'BLOCKQUOTE'){ out.push('\n\n' + n.textContent.trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n'); return; }
      if (tag === 'PRE'){ out.push('\n\n' + '```' + '\n' + n.textContent + '\n' + '```' + '\n\n'); return; }
      if (tag === 'STRONG'){ out.push('**' + n.textContent + '**'); return; }
      if (tag === 'EM' || tag === 'U' || tag === 'S'){ out.push('*' + n.textContent + '*'); return; }
      if (tag === 'CODE'){ out.push('`' + n.textContent + '`'); return; }
      if (tag === 'A'){ out.push('[' + n.textContent + '](' + (n.getAttribute('href') || '') + ')'); return; }
      if (tag === 'P' || tag === 'DIV'){ walk(n, out); out.push('\n\n'); return; }
      walk(n, out);
    });
  };
  const out = [];
  walk(t.content, out);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}
function htmlToText(html){
  const t = document.createElement('template');
  t.innerHTML = html;
  return (t.content.textContent || '').trim();
}

let toastTimer = null;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 2200);
}

/* ---------- 状态 ---------- */
const CURRENT_USER = '林同学';
const S = {
  feedSort:'hot', announce:true, postSort:'hot',
  likes:new Set(), commentLikes:new Set(),
  best:{p1:'c5'}, replyDrafts:new Map(),
  openReplies:new Set(), readNotifications:new Set(),
  wikiQueries:new Map(), searchQ:'', meTab:'posts', questionFilter:'all',
  bookmarks:new Set(bookmarkedIds), follows:new Set(),
  composerDraft:null,
  view:'compact', expandedPosts:new Set(), collapsedComments:new Set(),
  tagFollows:new Set(), reading:new Map(), threads:demoThreads, boardSort:new Map(), marketFilter:'sale',
  followedBoards:new Set(),
};
S.likes.add('p2'); S.likes.add('p4');
const postScore = p => p.likes + Number(S.likes.has(p.id));
const replyScore = (post, reply) => reply.likes + Number(S.commentLikes.has(post.id + ':' + reply.id));
const hotScore = p => postScore(p) - 2 * ageOf(p);
const sortPosts = (arr, mode = S.feedSort) => [...arr].sort((a,b) => {
  if (mode === 'hot') return hotScore(b) - hotScore(a);
  if (mode === 'activity') return lastActivity(b) - lastActivity(a);
  return b.createdAt - a.createdAt;
});
const stars = p => p.stars != null ? p.stars : Math.round(p.likes * 0.3);
const bodyHtmlOf = p => p.html ? cleanHtml(p.html) : esc(p.body).replace(/\n/g, '<br>');
const excerptOf = p => (p.html ? htmlToText(p.html) : p.body) ||
  p.project?.work || p.project?.feedback || p.project?.access || '';
const authorHref = name => name === CURRENT_USER ? '#/me' : '#/users/' + encodeURIComponent(name);
const authorLink = (name, className = 'thread-author') => `<a class="${className}" href="${authorHref(name)}">${esc(name)}</a>`;
function meetingInfo(post){
  const date = post.meetingAt ? new Date(post.meetingAt).toLocaleString('zh-CN', {
    month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false,
  }) : '';
  if (!date && !post.meeting) return '';
  return '<p class="post-meeting"><b>集合信息</b> ' + esc([date, post.meeting].filter(Boolean).join(' · ')) + '</p>';
}
const isQuestion = p => p.community === 'questions' || p.canSolve === true;
const usesHelpful = p => isQuestion(p) || p.community === 'resources';
const isSolved = p => Boolean(S.best[p.id]);
const canAcceptReply = p => p && isQuestion(p) && p.author === CURRENT_USER;
const wikiForCommunity = slug => wiki.filter(w => w.communities?.includes(slug));

function questionStatus(p){
  if (!isQuestion(p)) return '';
  const solved = isSolved(p);
  return `<span class="post-status question-status ${solved?'solved':'pending'}">${uiIcon(solved?'circle-check':'clock')}${solved?'已解决':'待解答'}</span>`;
}

/* ---------- 侧栏 / 右栏 ---------- */
const boardIcons = {
  daily:'leaf', questions:'circle-help', market:'shopping-bag',
  treehole:'messages-square', buddies:'users', resources:'folder-open',
};
const boardLink = c => `<a class="thread-board" href="#/c/${c.slug}">${uiIcon(boardIcons[c.slug])}${esc(c.name)}</a>`;

function renderSidebar(){
  const path = (location.hash || '#/').split('?')[0].replace('#/recommended', '#/bookmarks');
  const navLink = (href, label, icon, unread = false) => {
    const active = path === href || (href !== '#/' && path.startsWith(href + '/'));
    return `<a href="${href}" ${active ? 'class="on" aria-current="page"' : ''}>
      ${uiIcon(icon)}<span>${label}</span>${unread ? '<span class="unread-dot" aria-label="有未读私信"></span>' : ''}
    </a>`;
  };
  const today = new Date().setHours(0,0,0,0);
  const subscribed = communities.filter(c => S.followedBoards.has(c.slug));
  const boardLink = c => {
    const count = posts.filter(post => post.community === c.slug && post.createdAt >= today).length;
    const href = '#/c/' + c.slug;
    const active = path === href || path.startsWith(href + '/');
    return `<a class="c-row ${active ? 'on' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>
      <b>${uiIcon(boardIcons[c.slug])}${c.name}</b>
      ${count ? `<span class="n" aria-label="今日 ${count} 帖">${count}</span>` : ''}
    </a>`;
  };
  $('#sidebar').innerHTML = `
    <nav aria-label="主导航">
      <div class="sec">社区</div>
      ${navLink('#/', '首页', 'house')}
      ${navLink('#/discover', '发现', 'compass')}
      ${navLink('#/bookmarks', '收藏', 'bookmark')}
      ${navLink('#/wiki', 'Wiki', 'book-open')}
      <div class="sec">订阅板块</div>
      ${subscribed.length ? subscribed.map(boardLink).join('') : '<p class="sidebar-empty">还没有订阅板块</p>'}
      <div class="sec">我的</div>
      ${navLink('#/inbox', '私信', 'inbox', S.threads.some(thread => thread.unread))}
      ${navLink('#/me', '个人主页', 'user')}
    </nav>`;
}
function renderRail(context, board){
  $('#rail').classList.toggle('home-rail', context === 'home');
  if (context === 'home'){
    const following = S.feedSort === 'following';
    $('#rail').innerHTML = renderHomeRail() + dailyConversation(following
      ? posts.filter(p => S.followedBoards.has(p.community) || followsPost(p)) : posts);
    return;
  }
  if (context !== 'page'){ $('#rail').innerHTML = ''; return; }
  if (board){
    const entries = wikiForCommunity(board.slug);
    const top = sortPosts(posts.filter(post => post.community === board.slug), 'hot').slice(0,3);
    $('#rail').innerHTML = `
      <section class="panel"><h3>发帖提示</h3>${boardGuide(board.slug)}</section>
      ${entries.length ? `<section class="panel"><h3>板块 Wiki</h3>
        ${entries.slice(0,3).map(entry => `<div class="row"><a href="#/wiki/${entry.id}">${esc(entry.title)}</a></div>`).join('')}
      </section>` : ''}
      ${top.length ? `<section class="panel"><h3>板块讨论</h3>
        ${top.map(post => `<div class="row"><a href="#/posts/${post.id}">${esc(post.title)}</a></div>`).join('')}
      </section>` : ''}`;
    return;
  }
  $('#rail').innerHTML = renderHomeRail();
}

function renderHomeRail(){
  const top = sortPosts(posts, 'hot').slice(0,3);
  return `
    <section class="panel rail-wiki">
      <div class="rail-section-head">
        <h3>${uiIcon('book-open')} Wiki</h3>
        <a href="#/wiki">全部词条 ${uiIcon('arrow-up-right')}</a>
      </div>
      <ul>${wiki.slice(0,3).map(entry =>
        `<li><a href="#/wiki/${entry.id}">${esc(entry.title)}</a></li>`).join('')}</ul>
    </section>
    <section class="panel rail-ranking">
      <h3>讨论热榜</h3>
      <ol>${top.map((p, index) => `<li class="rank-item">
        <span class="rank-number" aria-hidden="true">0${index + 1}</span>
        <div>
          <a href="#/posts/${p.id}">${esc(p.title)}</a>
          <small><span>${comm(p.community).name}</span><span data-rail-score="${p.id}">${postScore(p)} 赞</span></small>
        </div>
      </li>`).join('')}</ol>
    </section>
    <section class="panel rail-tags">
      <h3>热门标签</h3>
      <div class="rail-tag-list">${topTags(6).map(([tag, count]) =>
        `<a href="#/tag/${encodeURIComponent(tag)}" aria-label="${esc(tag)}，${count} 帖">${esc(tag)}</a>`).join('')}</div>
    </section>`;
}

/* ---------- Feed ---------- */
function threadByline(post){
  return `<span class="thread-byline">
    ${authorLink(post.author)}<span aria-hidden="true">·</span>
    <span class="thread-published">${timeAgo(ageOf(post))}</span>
  </span>`;
}

function postReaction(post){
  const active = S.likes.has(post.id);
  return `<button type="button" class="act like-post ${active?'liked':''}" data-id="${post.id}" aria-label="点赞" aria-pressed="${active}">${heartSvg}<span class="cnt">${postScore(post)}</span></button>`;
}
function feedCard(p){
  const marked = S.bookmarks.has(p.id);
  const c = comm(p.community);
  const latest = latestReply(p);
  const excerpt = excerptOf(p);
  return `
  <article class="card feed-post" data-post="${p.id}">
    <div class="meta">
      ${boardLink(c)}
      ${threadByline(p)}
      ${isCampusProject(p) ? '<span class="project-badge">校园作品</span>' : ''}
      ${p.price ? `<span class="thread-price">${esc(p.price)}</span>` : ''}
    </div>
    <div class="topic-title-line"><h2><a href="#/posts/${p.id}">${esc(p.title)}</a></h2>${questionStatus(p)}${marketStatus(p)}</div>
    ${excerpt && excerpt !== p.title ? `<p class="excerpt">${esc(excerpt)}</p>` : ''}
    ${meetingInfo(p)}
    ${p.tags && p.tags.length ? '<div class="tags-row">' + p.tags.map(t => '<a class="tag-pill" href="#/tag/' + encodeURIComponent(t) + '">' + esc(t) + '</a>').join('') + '</div>' : ''}
    ${p.images && p.images.length ? `<div class="card-media"><img src="${esc(imageSrc(p.images[0]))}" alt=""></div>` : ''}
    <div class="foot">
      ${postReaction(p)}
      <a class="act" href="#/posts/${p.id}#comments">${chatSvg}<span>${(comments[p.id]||[]).length} 回复</span></a>
      ${unreadLink(p)}
      <button type="button" class="act star ${marked?'on':''}" data-bmk="${p.id}" aria-label="收藏" aria-pressed="${marked}">${uiIcon('bookmark')} ${stars(p) + (marked?1:0)}</button>
      ${S.feedSort==='hot' && hotScore(p) >= 30 ? '<span class="hot-tag">热门</span>' : ''}
    </div>
    ${latest ? latestReplyLink(p, latest) : ''}
  </article>`;
}
function renderFeed(list, mount){
  mount.innerHTML = list.length ? '<div class="feed-stack">' + list.map(feedCard).join('') + '</div>' :
    `<div class="empty"><p>还没有帖子</p><button class="btn-primary" onclick="openComposer()">发第一条帖子</button></div>`;
}

function viewControls(className = ''){
  return `<div class="seg view-controls ${className}" role="group" aria-label="帖子显示方式">
    <button type="button" class="${S.view==='card'?'on':''}" data-view="card" aria-pressed="${S.view==='card'}">${uiIcon('layout-grid')} 卡片</button>
    <button type="button" class="${S.view==='compact'?'on':''}" data-view="compact" aria-pressed="${S.view==='compact'}">${uiIcon('list')} 紧凑</button>
  </div>`;
}
function renderList(list, mount){
  if (S.view === 'compact'){
    mount.innerHTML = list.length ? `
      <div class="rows">
        <div class="rows-head" aria-hidden="true"><span>话题</span><span class="r-num">回复</span><span class="r-time">最近更新</span></div>
        ${list.map(p => {
          const c = comm(p.community);
          const replies = comments[p.id] || [];
          const latest = latestReply(p);
          const author = p.author;
          const initial = Array.from(author)[0] || '同';
          return `<div class="row-item">
            <div class="row-topic">
              <a class="thread-avatar" href="${authorHref(author)}" aria-label="查看${esc(author)}的主页">${esc(initial)}</a>
              <div class="thread-text">
                <div class="topic-title-line"><a class="r-title" href="#/posts/${p.id}">${esc(p.title)}</a>${questionStatus(p)}${marketStatus(p)}</div>
                <div class="r-meta">
                  ${boardLink(c)}
                  ${isCampusProject(p) ? '<span class="project-badge">校园作品</span>' : ''}
                  ${p.price ? `<span class="thread-price">${esc(p.price)}</span>` : ''}
                  ${unreadLink(p)}
                  ${p.tags?.length ? `<span class="thread-tags" aria-label="标签">${p.tags.map(tag => `<a class="tag-pill" href="#/tag/${encodeURIComponent(tag)}">${esc(tag)}</a>`).join('')}</span>` : ''}
                  ${usesHelpful(p) ? postReaction(p) : ''}
                </div>
              </div>
            </div>
            <a class="r-num" href="#/posts/${p.id}#comments" aria-label="${replies.length} 条回复">${replies.length}</a>
            ${latest ? `<a class="r-time" href="${replyHref(p, latest)}" aria-label="最近更新于${timeAgo(ageOf(latest))}，查看最新回复"><time datetime="${new Date(latest.createdAt).toISOString()}">${timeAgo(ageOf(latest))}</time></a>` : `<time class="r-time" datetime="${new Date(p.createdAt).toISOString()}">${timeAgo(ageOf(p))}</time>`}
          </div>`;
        }).join('')}
      </div>`
      : '<div class="empty">还没有帖子</div>';
    return;
  }
  renderFeed(list, mount);
}
function renderHome(){
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const board = communities.some(c => c.slug === params.get('board')) ? params.get('board') : '';
  const tags = [...new Set(posts.flatMap(post => post.tags || []))].sort((a,b) => a.localeCompare(b,'zh-CN'));
  const tag = tags.includes(params.get('tag')) ? params.get('tag') : '';
  const pinned = S.announce ? `
    <div class="announce"><span class="pin">${uiIcon('pin')} 置顶</span>
      <a href="#/wiki/w1">图书馆攻略更新了插座地图 ${uiIcon('arrow-up-right')}</a>
      <button type="button" class="x" aria-label="关闭公告" onclick="S.announce=false;route()">${uiIcon('x')}</button>
    </div>` : '';
  const following = S.feedSort === 'following';
  const feedPosts = following ? posts.filter(p => S.followedBoards.has(p.community) || followsPost(p)) : posts;
  const filtered = feedPosts.filter(post => (!board || post.community === board) && (!tag || post.tags?.includes(tag)));
  const list = sortPosts(filtered, following ? 'activity' : S.feedSort);
  $('#main').innerHTML = `
    <header class="forum-heading">
      <h1>首页</h1>
      <a href="#/wiki" class="forum-wiki-link">${uiIcon('book-open')} Wiki</a>
    </header>
    ${pinned}
    <div class="forum-toolbar">
      <div class="home-controls">
        <div class="tabs home-order" role="group" aria-label="首页帖子排序">
          <button type="button" class="${S.feedSort==='hot'?'on':''}" data-sort="hot" aria-pressed="${S.feedSort==='hot'}">热门</button>
          <button type="button" class="${S.feedSort==='latest'?'on':''}" data-sort="latest" aria-pressed="${S.feedSort==='latest'}">最新</button>
          <button type="button" class="${following?'on':''}" data-sort="following" aria-pressed="${following}">我关注的</button>
        </div>
        ${viewControls()}
      </div>
    </div>
    <div class="feed-filters" role="group" aria-label="筛选帖子">
      <label for="feed-board">板块<select id="feed-board">
        <option value="">不限板块</option>
        ${communities.map(c => `<option value="${c.slug}" ${board===c.slug?'selected':''}>${esc(c.name)}</option>`).join('')}
      </select></label>
      <label for="feed-tag">标签<select id="feed-tag">
        <option value="">不限标签</option>
        ${tags.map(t => `<option value="${esc(t)}" ${tag===t?'selected':''}>${esc(t)}</option>`).join('')}
      </select></label>
      ${board || tag ? '<button type="button" class="clear-feed-filters">清除筛选</button>' : ''}
      <span class="filter-count" role="status">${list.length} 个话题</span>
    </div>
    ${following && list.length && (S.follows.size || S.tagFollows.size) ? '<div class="follow-controls"><button class="link-btn" type="button" id="simulate-follow">演示同学的新动态</button></div>' : ''}
    <div id="feed"></div>`;
  if (!list.length && (board || tag)) $('#feed').innerHTML = '<p class="empty">没有符合当前筛选的话题，试试其他板块或标签。</p>';
  else if (following && !list.length) $('#feed').innerHTML = '<p class="empty">订阅板块，或关注感兴趣的帖子和标签，它们的更新会出现在这里。</p>';
  else renderList(list, $('#feed'));
  const simulate = $('#simulate-follow');
  if (simulate) simulate.onclick = simulateFollowActivity;
  const applyFilters = (nextBoard, nextTag) => {
    const next = new URLSearchParams();
    if (nextBoard) next.set('board', nextBoard);
    if (nextTag) next.set('tag', nextTag);
    location.hash = '#/' + (next.size ? '?' + next : '');
  };
  $('#feed-board').onchange = e => applyFilters(e.target.value, tag);
  $('#feed-tag').onchange = e => applyFilters(board, e.target.value);
  $('.clear-feed-filters')?.addEventListener('click', () => applyFilters('', ''));
  $('#main').querySelectorAll('[data-sort]').forEach(b =>
    b.onclick = () => { S.feedSort = b.dataset.sort; route(); $('.home-order .on').focus({preventScroll:true}); });
  if (list.length) $('#feed').insertAdjacentHTML('beforeend', '<p class="feed-end">已显示全部话题</p>');
}

/* ---------- 发现 ---------- */
function renderDiscover(){
  $('#main').innerHTML = `
    <header class="section-heading"><h1>发现</h1>
      <p>按主题浏览校园里的讨论、活动和资料。</p>
    </header>
    <div class="discover-grid">
      ${communities.map(c => {
        const topics = posts.filter(p => p.community === c.slug);
        const summaries = {
          questions:'待解答 ' + topics.filter(p => !isSolved(p)).length + ' 条',
          market:'在售 ' + topics.filter(isForSale).length + ' 件',
          buddies:'近 7 天活动 ' + topics.filter(isUpcoming).length + ' 场',
        };
        const summary = summaries[c.slug] || '话题 ' + topics.length + ' 条';
        return `
        <a class="card d-card" href="#/c/${c.slug}">
          <span class="board-mark">${uiIcon(boardIcons[c.slug])}</span>
          <h2>${c.name}</h2>
          <p>${c.desc}</p>
          <div class="stat"><span>${summary}</span><span>${wikiForCommunity(c.slug).length} 篇词条</span></div>
          <span class="go" aria-hidden="true">${uiIcon('arrow-up-right')}</span>
        </a>`;
      }).join('')}
    </div>`;
}

/* ---------- 个人主页 ---------- */
function renderUser(name){
  if (name === CURRENT_USER){ renderMe(); return; }
  const authored = posts.filter(post => post.author === name);
  const replies = posts.flatMap(post => (comments[post.id] || [])
    .filter(reply => reply.author === name).map(reply => ({post, reply})));
  if (!authored.length && !replies.length){
    $('#main').innerHTML = '<div class="empty">没有找到这位同学。<a href="#/">返回首页</a></div>';
    return;
  }
  const likes = authored.reduce((sum, post) => sum + postScore(post), 0) +
    replies.reduce((sum, item) => sum + replyScore(item.post, item.reply), 0);
  const tab = S.userProfile?.name === name ? S.userProfile.tab : 'posts';
  $('#main').innerHTML = `
    <a class="back" href="#/">← 返回首页</a>
    <section class="me-card profile-card public-profile" aria-labelledby="profile-name">
      <header class="profile-header">
        <div class="big-avatar" aria-hidden="true">${esc(Array.from(name)[0])}</div>
        <div class="profile-identity">
          <div class="profile-name-row"><h1 id="profile-name">${esc(name)}</h1></div>
          <p class="profile-school">${esc(profile.school)}</p>
        </div>
      </header>
      <dl class="profile-stats">
        <div><dt>发帖</dt><dd>${authored.length}</dd></div>
        <div><dt>回复</dt><dd>${replies.length}</dd></div>
        <div><dt>收到赞</dt><dd>${likes}</dd></div>
      </dl>
    </section>
    <div class="tabs profile-tabs" role="group" aria-label="个人动态">
      <button type="button" data-user-tab="posts" class="${tab==='posts'?'on':''}" aria-pressed="${tab==='posts'}">帖子</button>
      <button type="button" data-user-tab="replies" class="${tab==='replies'?'on':''}" aria-pressed="${tab==='replies'}">回复</button>
    </div>
    ${tab === 'posts' ? (authored.map(feedCard).join('') || '<div class="empty">还没有发布帖子</div>') :
      (replies.map(({post, reply}) => `<article class="panel"><a class="user-reply-topic" href="${replyHref(post,reply)}">${esc(post.title)}</a>
        <p>${esc(replyPreview(reply))}</p><small class="muted">${timeAgo(ageOf(reply))}</small></article>`).join('') || '<div class="empty">还没有回复</div>')}`;
  $('#main').querySelectorAll('[data-user-tab]').forEach(button => button.onclick = () => {
    S.userProfile = {name, tab:button.dataset.userTab};
    renderUser(name);
    $('#main .profile-tabs .on').focus({preventScroll:true});
  });
}
function renderMe(){
  if (S.meEdit){ renderMeEdit(); return; }
  const tab = S.meTab;
  const myPosts = posts.filter(p => p.author === CURRENT_USER);
  const marks = posts.filter(p => S.bookmarks.has(p.id));
  const likedPosts = posts.filter(p => S.likes.has(p.id));
  const gotLikes = myPosts.reduce((a,p)=>a+p.likes,0);
  let body = '';
  if (tab === 'posts'){
    body = myPosts.length
      ? myPosts.map(p => feedCard(p)).join('')
      : '<div class="empty"><p>你还没有发过帖子</p><button class="btn-primary" onclick="openComposer()">发布第一条</button></div>';
  } else if (tab === 'replies'){
    body = '<div class="panel">' + profileReplies.map(r => `
      <div class="list-row">
        <div><span class="t"><a href="#/posts/${r.pid}">${esc(r.post)}</a></span><small>${esc(r.snippet)}</small></div>
        <span class="muted" style="white-space:nowrap">${timeAgo(r.hoursAgo)}</span>
      </div>`).join('') + '</div>';
  } else if (tab === 'marks'){
    body = marks.length
      ? marks.map(p => feedCard(p)).join('') + (privacyPrefs.marksPublic ? '' : '<p class="muted" style="text-align:center">你的收藏当前仅自己可见，可在「账号与安全 → 隐私」中更改</p>')
      : '<div class="empty">还没有收藏的内容。可以在帖子里点击收藏。</div>';
  } else {
    body = likedPosts.length
      ? likedPosts.map(p => feedCard(p)).join('') + '<p class="muted" style="text-align:center">赞过的内容仅自己可见</p>'
      : '<div class="empty">还没有赞过的内容</div>';
  }
  $('#main').innerHTML = `
    <section class="me-card profile-card" aria-labelledby="profile-name">
      <header class="profile-header">
        <div class="big-avatar">${profile.avatar ? '<img src="' + profile.avatar + '" alt="">' : '林'}</div>
        <div class="profile-identity">
          <div class="profile-name-row">
            <h1 id="profile-name">${esc(profile.name)}</h1>
            <span class="profile-verified">${uiIcon('check')} 同校认证</span>
          </div>
          <p class="profile-school"><strong>${esc(profile.school)}</strong>${profile.campus ? ' · ' + esc(profile.campus) : ''}</p>
        </div>
        <div class="profile-actions">
          <a href="#/settings">设置</a>
          <button type="button" id="pf-edit">编辑资料</button>
        </div>
      </header>
      <div class="profile-details">
        ${profile.bio ? '<p class="profile-bio">' + esc(profile.bio) + '</p>' : ''}
        <div class="profile-meta">
          ${profile.dept || profile.year ? '<span>' + [profile.dept, profile.year].filter(Boolean).map(esc).join(' · ') + '</span>' : ''}
          <span>加入于 <time datetime="2023-09">2023 年 9 月</time></span>
        </div>
        ${profile.tags.length ? '<ul class="profile-interests" aria-label="兴趣标签" role="list">' + profile.tags.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : ''}
      </div>
      <dl class="profile-stats">
        <div><dt>发帖</dt><dd>${myPosts.length}</dd></div>
        <div><dt>回复</dt><dd>${profileReplies.length}</dd></div>
        <div><dt>收到赞</dt><dd>${gotLikes}</dd></div>
        <div><dt>收藏</dt><dd>${marks.length}</dd></div>
      </dl>
    </section>
    <div class="tabs profile-tabs">
      <button class="${tab==='posts'?'on':''}" data-t="posts">帖子</button>
      <button class="${tab==='replies'?'on':''}" data-t="replies">回复</button>
      <button class="${tab==='marks'?'on':''}" data-t="marks">收藏</button>
      <button class="${tab==='likes'?'on':''}" data-t="likes">赞过<span class="vis-note">仅自己可见</span></button>
    </div>` + body;
  $('#main').querySelectorAll('.tabs button').forEach(b =>
    b.onclick = () => { S.meTab = b.dataset.t; renderMe(); });
  const pe = document.getElementById('pf-edit');
  if (pe) pe.onclick = () => { S.meEdit = true; renderMe(); };
}

/* ---------- 个人资料内联编辑 ---------- */
function renderMeEdit(){
  $('#main').innerHTML = `
    <a class="back" href="#/me">← 返回个人主页</a>
    <div class="page-head"><h1>编辑个人资料</h1></div>
    <div class="me-card">
      <div class="profile-banner"></div>
      <div style="padding:0 22px 16px;margin-top:-26px;position:relative;z-index:2">
        <div class="avatar-edit" style="margin-top:12px">
          <div class="big-avatar">${profile.avatar ? '<img src="' + profile.avatar + '" alt="">' : '林'}</div>
          <div>
            <label class="tb" style="border:1px solid var(--border);border-radius:18px;padding:6px 14px;cursor:pointer">更换头像<input type="file" id="avatar-file" accept="image/*" hidden></label>
            <small class="muted" style="display:block">支持 JPG/PNG，1MB 内（演示）</small>
          </div>
        </div>
        <div class="set-form">
          <div><label>昵称</label><input id="pf-name" value="${esc(profile.name)}" maxlength="20"></div>
          <div><label>手机号</label><input value="138****2648" disabled></div>
          <div class="full"><label>一句话简介</label><input id="pf-bio" value="${esc(profile.bio)}" maxlength="60"></div>
          <div><label>校区</label><input id="pf-campus" value="${esc(profile.campus)}"></div>
          <div><label>院系</label><input id="pf-dept" value="${esc(profile.dept)}"></div>
          <div><label>年级</label><input id="pf-year" value="${esc(profile.year)}"></div>
          <div class="full"><label>兴趣标签</label>
            <div class="tag-inputs" id="pf-tags">${profile.tags.map((t,i) => '<span class="tag">' + esc(t) + '<span data-rm="' + i + '">×</span></span>').join('')}
              <input id="pf-tag-new" placeholder="添加标签，回车确认" style="width:160px">
            </div>
          </div>
        </div>
        <div class="cmp-actions" style="justify-content:flex-end;margin-top:14px">
          <button class="btn-ghost" id="pf-cancel">取消</button>
          <button class="btn-primary" id="pf-save">保存资料</button>
        </div>
      </div>
    </div>
    <div class="tabs profile-tabs">
      <button class="${S.meTab==='posts'?'on':''}" data-t="posts">帖子</button>
      <button class="${S.meTab==='replies'?'on':''}" data-t="replies">回复</button>
      <button class="${S.meTab==='marks'?'on':''}" data-t="marks">收藏</button>
      <button class="${S.meTab==='likes'?'on':''}" data-t="likes">赞过<span class="vis-note">仅自己可见</span></button>
    </div>`;
  $('#avatar-file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    profile.avatar = URL.createObjectURL(f);
    renderMeEdit(); toast('头像已更新（演示，未上传服务器）');
  };
  const bind = (id, key) => { const el = $(id); if (el) el.oninput = () => profile[key] = el.value; };
  bind('#pf-name','name'); bind('#pf-bio','bio'); bind('#pf-campus','campus'); bind('#pf-dept','dept'); bind('#pf-year','year');
  $('#pf-tags').querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { profile.tags.splice(+x.dataset.rm,1); renderMeEdit(); });
  const tagNew = $('#pf-tag-new');
  tagNew.onkeydown = e => {
    if (e.key === 'Enter' && tagNew.value.trim()){
      if (profile.tags.length >= 6){ toast('最多 6 个标签'); return; }
      profile.tags.push(tagNew.value.trim()); renderMeEdit();
    }
  };
  $('#pf-save').onclick = () => { S.meEdit = false; toast('资料已保存'); route(); };
  $('#pf-cancel').onclick = () => { S.meEdit = false; renderMe(); };
}
/* ---------- 设置中心 ---------- */
function renderSettings(){
  const tab = S.setTab || 'account';
  const nav = [['account','账号与安全'],['notify','通知偏好'],['privacy','隐私'],['general','通用']];
  let panel = '';
  if (tab === 'account') panel = accountPanel();
  else if (tab === 'notify') panel = notifyPanel();
  else if (tab === 'privacy') panel = privacyPanel();
  else panel = generalPanel();
  $('#main').innerHTML = `
    <a class="back" href="#/me">← 返回个人主页</a>
    <div class="page-head"><h1>设置</h1></div>
    <nav class="set-nav">${nav.map(([k,l]) => '<a href="#/settings" data-st="' + k + '" class="' + (tab===k?'on':'') + '">' + l + '</a>').join('')}</nav>
    <div id="set-panel">${panel}</div>`;
  $('#main').querySelectorAll('.set-nav a').forEach(a => a.onclick = e => { e.preventDefault(); S.setTab = a.dataset.st; renderSettings(); });
  wireSettings(tab);
}
function sw(key, on){ return '<button class="switch ' + (on?'on':'') + '" data-sw="' + key + '" aria-label="开关"></button>'; }
function accountPanel(){
  const verifyRows = `
    <div class="set-row"><div class="k">同校认证<small>已认证 · 2024-03-12，联系方式仅向同校学生展示</small></div><div class="v"><span style="color:var(--action);font-weight:700">${uiIcon('check')} 已认证</span> <button class="link-btn" onclick="toast('演示：查看认证详情')">查看</button></div></div>
    `;
  const securityRows = `
    <div class="set-row"><div class="k">手机号<small>用于登录与找回账号</small></div><div class="v">138****2648 <button class="link-btn" onclick="toast('演示：进入换绑手机流程')">更换</button></div></div>
    <div class="set-row"><div class="k">微信绑定<small>用于快捷登录与订阅消息</small></div><div class="v">已绑定 <button class="link-btn" onclick="toast('演示：管理微信绑定')">管理</button></div></div>
    <div class="set-row"><div class="k">登录密码</div><div class="v">上次修改于 3 个月前 <button class="link-btn" onclick="toast('演示：进入修改密码流程')">修改</button></div></div>
    <div class="set-row"><div class="k">两步验证<small>登录时额外要求验证码，更安全</small></div><div class="v">${sw('2fa', false)}</div></div>`;
  const deviceRows = loginDevices.map((d,i) => `
    <div class="dev-row">
      <div><b style="font-weight:600">${esc(d.name)}</b> ${d.current ? '<span class="cur">当前设备</span>' : ''}<br><small class="muted">${esc(d.meta)}</small></div>
      ${d.current ? '' : '<button class="link-btn" data-kick="' + i + '" style="color:#b3402e">踢下线</button>'}
    </div>`).join('');
  const dangerRows = `
    <div class="set-row"><div class="k">导出我的数据<small>帖子、回复与账号信息打包下载</small></div><div class="v"><button class="link-btn" onclick="toast('演示：数据打包后将发送到你的邮箱')">导出</button></div></div>
    <div class="set-row"><div class="k">注销账号<small>7 天冷静期，期间可撤回</small></div><div class="v"><button class="link-btn" id="delete-account" style="color:#b3402e;font-weight:700">注销账号</button></div></div>`;
  return `
    <div class="set-sec"><h2>账号身份</h2>${verifyRows}</div>
    <div class="set-sec"><h2>登录与安全</h2>${securityRows}</div>
    <div class="set-sec"><h2>登录设备管理</h2>${deviceRows}</div>
    <div class="set-sec"><h2 class="danger">危险区</h2>${dangerRows}</div>`;
}
function notifyPanel(){
  const rows = [
    ['reply','回复我的','有人回复我的帖子或评论'],
    ['like','赞与收藏','我收到的赞和收藏'],
    ['follow','关注更新','关注的标签有新帖，或关注的帖子有新回复'],
    ['system','系统公告','审核结果与平台通知'],
  ].map(([k,label,sub]) => '<div class="set-row"><div class="k">' + label + '<small>' + sub + '</small></div><div class="v">' + sw('n:'+k, notifPrefs[k]) + '</div></div>').join('');
  return '<div class="set-sec"><h2>通知偏好</h2>' + rows + '</div>';
}
function privacyPanel(){
  const rows = `
    <div class="set-row"><div class="k">个人主页公开<small>关闭后仅同校认证用户可见</small></div><div class="v">${sw('p:profilePublic', privacyPrefs.profilePublic)}</div></div>
    <div class="set-row"><div class="k">收藏公开<small>关闭后收藏列表仅自己可见</small></div><div class="v">${sw('p:marksPublic', privacyPrefs.marksPublic)}</div></div>`;
  return '<div class="set-sec"><h2>隐私</h2>' + rows + '</div>';
}
function generalPanel(){
  const rows = `
    <div class="set-row"><div class="k">主题<small>演示：仅浅色可用</small></div><div class="v"><select id="gen-theme" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;font:inherit;background:var(--surface-subtle)"><option>浅色</option><option>跟随系统</option></select></div></div>
    <div class="set-row"><div class="k">语言</div><div class="v"><select id="gen-lang" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;font:inherit;background:var(--surface-subtle)"><option>简体中文</option><option>English</option></select></div></div>
    <div class="set-row"><div class="k">正文字号</div><div class="v"><select id="gen-font" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;font:inherit;background:var(--surface-subtle)"><option>标准</option><option>大</option></select></div></div>
    <div class="set-row"><div class="k">缓存<small>清理本地临时图片与数据</small></div><div class="v"><button class="link-btn" id="gen-cache">清除缓存</button></div></div>`;
  return '<div class="set-sec"><h2>通用</h2>' + rows + '</div>';
}
function wireSettings(tab){
  /* 开关（通知/隐私/两步验证通用） */
  $('#main').querySelectorAll('[data-sw]').forEach(b => b.onclick = () => {
    const k = b.dataset.sw; b.classList.toggle('on');
    const on = b.classList.contains('on');
    if (k === '2fa') toast(on ? '两步验证已开启' : '两步验证已关闭');
    else if (k.startsWith('n:')) { notifPrefs[k.slice(2)] = on; saveDemo(); }
    else if (k.startsWith('p:')) { privacyPrefs[k.slice(2)] = on; if (k === 'p:marksPublic') toast(on ? '收藏已公开' : '收藏已设为仅自己可见'); }
  });
  if (tab === 'account'){
    $('#main').querySelectorAll('[data-kick]').forEach(b => b.onclick = () => {
      loginDevices.splice(+b.dataset.kick,1); renderSettings(); toast('已踢下线');
    });
    $('#delete-account').onclick = () => {
      if (confirm('确定注销账号？所有内容将匿名化处理，7 天后生效，期间登录可撤回。'))
        toast('演示：已提交注销申请，7 天后生效');
    };
  }
  if (tab === 'general'){
    ['gen-theme','gen-lang','gen-font'].forEach(id => { const el = $(id); if (el) el.onchange = () => toast('演示：已保存，重新登录后生效'); });
    $('#gen-cache').onclick = () => toast('演示：已清除 12.6MB 缓存');
  }
}
/* ---------- 社区页 ---------- */
function renderCommunity(slug, section){
  const c = comm(slug); if (!c) return renderHome();
  const tab = section === 'wiki' || (slug === 'market' && section === 'rules') ? section : 'feed';
  const base = '#/c/' + slug;
  const subscribed = S.followedBoards.has(slug);
  const topics = posts.filter(p => p.community === slug);
  const entries = wikiForCommunity(slug);
  const sort = S.boardSort.get(slug) || 'activity';
  const head = `
    <div class="page-head community-head">
      <div><h1>${c.name}${tab === 'wiki' ? ' Wiki' : ''}</h1></div>
      <div class="board-actions">
        <a class="forum-wiki-link" href="${tab === 'wiki' ? base : base + '/wiki'}">${uiIcon(tab === 'wiki' ? 'messages-square' : 'book-open')} ${tab === 'wiki' ? '返回帖子' : '板块 Wiki'}</a>
        <button type="button" class="link-btn" id="subscribe-board" aria-pressed="${subscribed}">${subscribed ? '取消订阅' : '订阅板块'}</button>
        <button type="button" class="btn-primary board-compose" onclick="openComposer('${slug}')">${uiIcon('plus')} 发帖</button>
      </div>
    </div>`;
  let body = '';
  if (tab === 'feed'){
    body = `
      <form id="board-search" class="board-search">
        <label class="sr-only" for="board-search-q">搜本板块</label>
        <input id="board-search-q" type="search" placeholder="搜本板块">
        <button type="submit" class="link-btn">搜索</button>
      </form>
      <div class="community-toolbar">
        <label class="board-sort"><span class="sr-only">板块排序</span><select id="board-sort">
          <option value="activity" ${sort==='activity'?'selected':''}>最近回复</option>
          <option value="latest" ${sort==='latest'?'selected':''}>最新发布</option>
        </select></label>
        ${viewControls('community-view')}
      </div>
      <div id="c-feed"></div>`;
  } else if (tab === 'wiki'){
    body = wikiIndexHtml(entries, slug);
  } else if (tab === 'rules'){
    body = marketRules();
  }
  $('#main').innerHTML = `<a class="back" href="#/">← 返回首页</a>` + head + body;
  $('#subscribe-board').onclick = event => {
    if (S.followedBoards.has(slug)) S.followedBoards.delete(slug);
    else S.followedBoards.add(slug);
    const active = S.followedBoards.has(slug);
    event.currentTarget.textContent = active ? '取消订阅' : '订阅板块';
    event.currentTarget.setAttribute('aria-pressed', String(active));
    saveDemo();
    renderSidebar();
    toast(active ? '已订阅，板块已加入侧栏' : '已取消订阅，板块已从侧栏移除');
  };
  if (tab === 'wiki') bindWikiSearch(entries, slug);
  if (tab === 'feed'){
    $('#board-search').onsubmit = event => {
      event.preventDefault();
      const query = $('#board-search-q').value.trim();
      if (query) location.hash = searchHref(query, 'all', slug);
    };
    renderList(sortPosts(topics, sort), $('#c-feed'));
    $('#board-sort').onchange = e => {
      S.boardSort.set(slug, e.target.value);
      saveDemo();
      route();
      $('#board-sort').focus({preventScroll:true});
    };
  }
}
/* ---------- 帖子详情 ---------- */
function commentNode(cm, post, children, threadId, depth = 0){
  const key = post.id + ':' + cm.id;
  const liked = S.commentLikes.has(key);
  const best = S.best[post.id] === cm.id;
  const kids = children.get(cm.id) || [];
  const author = esc(replyAuthor(post, cm));
  const quote = cm.replyTo ? '<a class="c-quote" href="#/posts/' + post.id + '#cm-' + cm.replyTo + '">回复 @' + esc(cm.replyToName) + '：' + esc((cm.replyBody||'').slice(0,30)) + '…</a>' : '';
  const subCollapsed = S.collapsedComments.has(key);
  const open = S.openReplies.has(key);
  const shown = subCollapsed ? [] : open ? kids : kids.slice(0, 2);
  let inner = `
    <div class="c-head">
      ${authorLink(cm.author, 'name')}
      ${cm.author === post.author ? '<span class="op">楼主</span>' : ''}
      <time>${timeAgo(ageOf(cm))}</time>
      ${best ? '<span class="best-mark">最佳回复</span>' : ''}
    </div>
    ${quote}
    ${cm.body ? `<div class="c-body">${esc(cm.body)}</div>` : ''}
    ${cm.image ? `<img class="reply-image" src="${esc(imageSrc(cm.image))}" alt="回复图片">` : ''}
    <div class="c-foot">
      <button type="button" class="act clike ${liked?'liked':''}" data-id="${key}" aria-label="点赞回复" aria-pressed="${liked}">${heartSvg}<span class="cnt">${replyScore(post, cm)}</span></button>
      <button type="button" class="act creply" data-id="${cm.id}" data-name="${author}" data-body="${esc(replyPreview(cm))}">回复</button>
      <button type="button" class="act" data-copy-reply="${esc(replyHref(post, cm))}" aria-label="复制此回复链接">复制链接</button>
      ${kids.length && threadId !== cm.id ? `<a class="act" href="#/posts/${post.id}?thread=${encodeURIComponent(cm.id)}#comments">只看这串</a>` : ''}
      ${canAcceptReply(post) ? '<button type="button" class="act cbest" data-id="' + cm.id + '">' + (best?'取消采纳':'采纳为最佳回复') + '</button>' : ''}
    </div>
    ${best && canAcceptReply(post) ? answerWikiForm(post, cm) : ''}`;
  if (kids.length){
    inner += `<button type="button" class="fold" data-collapse="${key}" aria-expanded="${!subCollapsed}" aria-controls="replies-${cm.id}">${subCollapsed ? '展开 ' + kids.length + ' 条回复' : '折叠回复'}</button>
      <div class="replies" id="replies-${cm.id}" ${subCollapsed ? 'hidden' : ''}>${shown.map(k => commentNode(k, post, children, threadId, Math.min(depth + 1, 3))).join('')}</div>`;
    if (!subCollapsed && shown.length < kids.length)
      inner += `<button type="button" class="fold" data-parent="${key}" data-next="${kids[shown.length].id}">展开其余 ${kids.length - shown.length} 条回复</button>`;
  }
  return `<article class="comment ${best?'best':''}" id="cm-${cm.id}" data-depth="${depth}" tabindex="-1">${inner}</article>`;
}
function renderPost(id, anchor){
  const p = posts.find(x => x.id === id);
  if (!p) return renderHome();
  const c = comm(p.community);
  const origin = navigationPage?.origin;
  const own = p.author === CURRENT_USER;
  const marked = S.bookmarks.has(id);
  const following = S.follows.has(id);
  const list = comments[id] || [];
  const threadId = currentThreadId();
  const thread = list.find(reply => reply.id === threadId);
  const acceptedId = thread ? null : S.best[id];
  const children = new Map();
  const sorted = [...list].sort((a,b) => S.postSort === 'hot'
    ? replyScore(p, b) - replyScore(p, a) || b.createdAt - a.createdAt
    : b.createdAt - a.createdAt);
  for (const reply of sorted){
    const parent = reply.id === acceptedId ? null : reply.parentId || null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(reply);
  }
  const roots = thread ? [thread] : children.get(null) || [];
  const answerIndex = roots.findIndex(reply => reply.id === acceptedId);
  if (answerIndex > 0) roots.unshift(...roots.splice(answerIndex, 1));
  const related = relatedTopics(p);
  const contact = p.author !== CURRENT_USER && contacts.find(peer => peer.name === p.author);
  if (thread && anchor){
    const key = id + ':' + thread.id;
    S.collapsedComments.delete(key);
    S.openReplies.add(key);
  }
  if (anchor?.startsWith('cm-')){
    let target = list.find(cm => cm.id === anchor.slice(3));
    while (target?.parentId){
      const key = id + ':' + target.parentId;
      S.collapsedComments.delete(key);
      S.openReplies.add(key);
      target = list.find(cm => cm.id === target.parentId);
    }
  }
  const fullText = (p.html ? htmlToText(p.html) : p.body);
  const long = fullText.length > 320 && !S.expandedPosts.has(id);
  $('#main').innerHTML = `
    <a class="back" id="post-back" href="${esc(origin?.href || '#/c/' + c.slug)}">← 返回 ${esc(origin?.label || c.name)}</a>
    <article class="card post-card" data-topic="${id}">
      <div class="meta">
        ${boardLink(c)}
        ${threadByline(p)}
        ${p.price ? `<span class="thread-price">${esc(p.price)}</span>` : ''}
        ${isCampusProject(p) ? '<span class="project-badge">校园作品</span>' : ''}
      </div>
      <div class="topic-title-line post-title-line"><h1>${esc(p.title)}</h1>${questionStatus(p)}${marketStatus(p)}</div>
      ${p.tags && p.tags.length ? '<div class="tags-row" style="margin:6px 0 4px">' + p.tags.map(t => '<a class="tag-pill" href="#/tag/' + encodeURIComponent(t) + '">' + esc(t) + '</a>').join('') + '</div>' : ''}
      ${meetingInfo(p)}
      <div class="body body-html ${long?'body-collapsed':''}" id="post-body">${bodyHtmlOf(p)}</div>
      ${long ? '<div class="expand-bar"><button data-expand="' + id + '">' + (S.expandedPosts.has(id) ? '收起' : '展开全文') + '</button></div>' : ''}
      ${p.images && p.images.length ? `<div class="card-media">${p.images.map(src => '<img src="' + esc(imageSrc(src)) + '" alt="">').join('')}</div>` : ''}
      ${projectDetails(p)}
      ${p.updates?.length ? `<section class="topic-updates" aria-label="楼主进展"><h2>楼主进展</h2>
        ${p.updates.map((update,index) => `<article id="topic-update-${index}" tabindex="-1">
          <time datetime="${new Date(update.createdAt).toISOString()}">${new Date(update.createdAt).toLocaleString('zh-CN',{hour12:false})}</time>
          <p>${esc(update.body)}</p>
        </article>`).join('')}
      </section>` : ''}
      ${own ? `<details class="topic-update-editor">
        <summary>追加进展</summary>
        <form id="topic-update-form">
          <label class="sr-only" for="topic-update-text">进展内容</label>
          <textarea id="topic-update-text" maxlength="500" required placeholder="补充结果、地点变更或新的资料"></textarea>
          <button type="submit" class="btn-primary">发布进展</button>
        </form>
      </details>` : ''}
      <div class="post-vote">
        ${postReaction(p)}
        <button type="button" class="act star ${marked?'on':''}" data-bmk="${id}" aria-pressed="${marked}">${uiIcon('bookmark')} ${marked?'已收藏':'收藏'} ${stars(p) + (marked?1:0)}</button>
        <button type="button" class="act follow ${following?'on':''}" data-follow="${id}" aria-pressed="${following}">${uiIcon('bell')} ${following?'已关注':'关注'}</button>
        ${p.community === 'market' && p.author === CURRENT_USER ? `<button type="button" class="act" id="market-toggle">${p.sold?'恢复在售':'标记已出'}</button>` : ''}
        ${contact && ['market','buddies'].includes(p.community) ? `<a class="act" href="${inboxHref(contact.id,p.id)}">${p.community==='market'?'联系卖家':'联系发起人'}</a>` : ''}
        <span class="share-wrap">
          <button type="button" class="act share-toggle" aria-expanded="false">${uiIcon('share-2')} 分享</button>
          <span class="share-drop" hidden>
            <button data-share="copy">${uiIcon('link')} 复制链接</button>
            <button data-share="poster">${uiIcon('image')} 生成分享海报</button>
            <button data-share="send">${uiIcon('inbox')} 转发给同学</button>
          </span>
        </span>
        <span class="spacer"></span>
        <button class="icon-btn" title="举报" onclick="toast('已收到举报，管理员会尽快处理')">${uiIcon('flag')}</button>
      </div>
    </article>
    <section id="comments" tabindex="-1" aria-labelledby="reply-heading">
      <div class="comments-head">
        <h2 id="reply-heading">${thread ? '当前讨论串' : '回复 · ' + list.length}</h2>
        <div class="seg" role="group" aria-label="回复排序">
          <button class="${S.postSort==='hot'?'on':''}" data-s="hot" aria-pressed="${S.postSort==='hot'}">最热</button>
          <button class="${S.postSort==='latest'?'on':''}" data-s="latest" aria-pressed="${S.postSort==='latest'}">最新</button>
        </div>
      </div>
      ${thread ? `<a class="thread-return" href="${replyHref(p, thread)}">← 返回全部回复中的这一楼</a>` : ''}
      <div id="cmts">${roots.map(cm => commentNode(cm, p, children, thread?.id)).join('') || '<div class="empty">还没有回复，<button class="act" type="button" id="reply-first">写下第一条回复</button></div>'}</div>
    </section>
    <div class="comments-head" style="margin-top:30px"><h2>相关讨论</h2></div>
    ${related.length ? `<div class="suggest-grid">${related.map(feedCard).join('')}</div>` :
      `<a class="link-btn" href="#/c/${c.slug}">查看更多${esc(c.name)}</a>`}
    <div style="height:8px"></div>`;
  $('#comments').querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    S.postSort = b.dataset.s;
    renderPost(id);
    $('#comments [data-s="' + S.postSort + '"]').focus({preventScroll:true});
  });
  $('#post-back').onclick = returnToPostList;
  const updateForm = $('#topic-update-form');
  if (updateForm) updateForm.onsubmit = event => {
    event.preventDefault();
    const input = $('#topic-update-text');
    const body = input.value.trim();
    if (!body){ input.focus(); return; }
    (p.updates ||= []).push({body, createdAt:Date.now()});
    saveDemo();
    renderPost(id);
    focusContent($('#topic-update-' + (p.updates.length - 1)));
    toast('已追加进展');
  };
  renderComposerBar(p);
  const firstReply = $('#reply-first');
  if (firstReply) firstReply.onclick = () => $('#reply-input').focus();
  const marketToggle = $('#market-toggle');
  if (marketToggle) marketToggle.onclick = () => {
    p.sold = !p.sold;
    saveDemo();
    renderPost(id);
    $('#market-toggle').focus({preventScroll:true});
    toast(p.sold ? '已标记为已出' : '已恢复在售');
  };
  const wikiForm = $('.answer-wiki');
  if (wikiForm) wikiForm.onsubmit = e => {
    e.preventDefault();
    if (!canAcceptReply(p) || S.best[id] !== wikiForm.dataset.answer) return;
    const article = wikiForCommunity(p.community).find(w => w.id === $('#answer-wiki-id').value);
    if (article) p.wikiRef = {
      id:article.id, answerId:wikiForm.dataset.answer,
      ...(p.wikiRef?.id === article.id && p.wikiRef.section ? {section:p.wikiRef.section} : {}),
    };
    else delete p.wikiRef;
    saveDemo();
    renderPost(id);
    $('#answer-wiki-id').focus({preventScroll:true});
    toast(article ? '已关联词条' : '已移除词条关联');
  };
}
function renderComposerBar(post, replyTarget){
  const bar = $('#composer-bar');
  bar.hidden = false;
  const draft = S.replyDrafts.get(post.id) || {text:'', target:null};
  if (replyTarget) draft.target = replyTarget;
  S.replyDrafts.set(post.id, draft);
  const rt = draft.target;
  bar.innerHTML = `
    ${rt ? '<div class="quote-bar"><span>↩ 正在回复 <b>' + esc(rt.name) + '</b>：' + esc(rt.body.slice(0,30)) + '…</span><button type="button" class="x" id="quote-x" aria-label="取消引用">×</button></div>' : ''}
    ${draft.image ? `<div class="reply-image-preview">
      <img src="${esc(imageSrc(draft.image))}" alt="待发送图片">
      <button type="button" class="link-btn" id="reply-remove-image">移除图片</button>
    </div>` : ''}
    <div class="composer-row">
      <input id="reply-input" aria-label="回复内容" placeholder="${rt ? '回复 @' + esc(rt.name) + '…' : '友善地写下你的回复…'}" maxlength="500">
      <button type="button" class="act reply-attach" id="reply-add-image">${draft.image ? '换图' : '图片'}</button>
      <input type="file" id="reply-file" accept="image/*" hidden>
      <button type="button" class="btn-send" id="reply-send">发送</button>
    </div>`;
  const input = $('#reply-input');
  input.value = draft.text;
  input.oninput = () => { draft.text = input.value; saveDemo(); };
  const file = $('#reply-file');
  $('#reply-add-image').onclick = () => file.click();
  const setImage = image => {
    if (draft.image){
      URL.revokeObjectURL(imageUrls.get(draft.image));
      imageUrls.delete(draft.image);
    }
    draft.image = image;
    saveDemo();
    renderComposerBar(post);
    $('#reply-add-image').focus({preventScroll:true});
  };
  file.onchange = () => {
    const image = file.files[0];
    if (!image) return;
    if (!image.type.startsWith('image/')) { toast('请选择图片文件'); return; }
    setImage(image);
  };
  const removeImage = $('#reply-remove-image');
  if (removeImage) removeImage.onclick = () => setImage(null);
  if (replyTarget) input.focus();
  const send = () => {
    const v = input.value.trim(); if (!v && !draft.image) return;
    const cm = {
      id:'c'+crypto.randomUUID(), author:CURRENT_USER, hoursAgo:0, likes:0, body:v,
      ...(draft.image ? {image:draft.image} : {}),
      ...(rt ? {parentId:rt.id, replyTo:rt.id, replyToName:rt.name, replyBody:rt.body} : {}),
    };
    addReply(post, cm);
    S.replyDrafts.delete(post.id);
    saveDemo();
    const anchor = 'cm-' + cm.id;
    renderPost(post.id, anchor);
    focusPostAnchor(anchor);
    toast('回复已发布');
  };
  $('#reply-send').onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) send(); };
  const qx = $('#quote-x');
  if (qx) qx.onclick = () => {
    draft.target = null;
    saveDemo();
    renderComposerBar(post);
    $('#reply-input').focus();
  };
}

function focusPostAnchor(anchor){
  const target = document.getElementById(anchor) || $('#comments');
  focusContent(target);
}
function focusContent(target){
  target.focus({preventScroll:true});
  target.scrollIntoView({block:'start', behavior:'instant'});
}
/* ---------- 标签聚合页 ---------- */
function renderTag(name){
  const list = sortPosts(posts.filter(p => (p.tags||[]).includes(name)));
  const followed = S.tagFollows.has(name);
  $('#main').innerHTML = `
    <a class="back" href="#/">← 返回首页</a>
    <div class="card tag-head">
      <div><h1>${esc(name)}</h1><p class="m">${list.length} 个帖子 · 标签聚合页</p></div>
      <button class="btn-ghost" data-tagfollow="${esc(name)}" aria-pressed="${followed}">${uiIcon('bell')} ${followed ? '已关注' : '关注此标签'}</button>
    </div>
    <div id="feed"></div>`;
  renderList(list, $('#feed'));
}
function topTags(n){
  const cnt = {};
  posts.forEach(p => (p.tags||[]).forEach(t => cnt[t] = (cnt[t]||0)+1));
  return Object.entries(cnt).sort((a,b) => b[1]-a[1]).slice(0, n || 6);
}
/* ---------- Wiki ---------- */
const wikiSectionId = (section, index) => 'ws-' + (section.id || index);
let wikiTocObserver;

function postWikiHref(post){
  const ref = post.wikiRef;
  const article = ref && wiki.find(w => w.id === ref.id);
  if (!article) return '#/c/' + post.community + '/wiki';
  const index = article.sections.findIndex(section => section.id && section.id === ref.section);
  const section = index < 0 ? '' : '#' + wikiSectionId(article.sections[index], index);
  return '#/wiki/' + article.id + section;
}
function answerWikiForm(post, reply){
  const articles = wikiForCommunity(post.community);
  if (!articles.length) return '';
  return `<form class="answer-wiki" data-answer="${reply.id}">
    <label for="answer-wiki-id">将答案关联到Wiki</label>
    <select id="answer-wiki-id">
      <option value="">不关联</option>
      ${articles.map(article => `<option value="${article.id}" ${post.wikiRef?.id===article.id?'selected':''}>${esc(article.title)}</option>`).join('')}
    </select>
    <button type="submit" class="btn-ghost">保存关联</button>
  </form>`;
}
/* ---------- 发帖弹层 ---------- */
function openComposer(community, topicId){
  const draft = S.composerDraft;
  const body = draft && (draft.mode === 'rich' ? htmlToText(draft.html) : draft.md.trim());
  if (!draft || ![draft.title, body, draft.price, draft.meeting, draft.meetingTime, draft.tagInput,
    draft.images.length, draft.tags.length, ...Object.values(draft.project || {})].some(Boolean)){
    S.composerDraft = {
      community:community || 'questions', title:'', html:'', md:'', mode:'rich',
      price:'', meeting:'', meetingTime:'', tagInput:'', images:[], tags:[], showTools:false, showEmoji:false,
      projectEnabled:false, project:{},
    };
  }
  if (S.composerDraft.community === 'resources' && community === 'resources' && topicId === 'project'){
    S.composerDraft.projectEnabled = true;
  }
  renderComposerModal();
  $('#composer').showModal();
  if (S.composerDraft.community === 'daily'){
    $(S.composerDraft.mode === 'rich' ? '#rte' : '#md-ta').focus();
  }
}
function editorBlock(draft){
  return `
    <div>
      <div class="editor-heading">
        <label id="cmp-body-label" for="${draft.mode === 'rich' ? 'rte' : 'md-ta'}">正文</label>
        ${draft.mode === 'md' ? '<span class="editor-mode">Markdown</span>' : ''}
      </div>
      <details class="editor-options" id="cmp-editor-tools" ${draft.showTools ? 'open' : ''}>
        <summary>排版与 Markdown</summary>
        <div class="mode-tabs">
          <button type="button" id="mode-rich" class="${draft.mode==='rich'?'on':''}" aria-pressed="${draft.mode==='rich'}">富文本</button>
          <button type="button" id="mode-md" class="${draft.mode==='md'?'on':''}" aria-pressed="${draft.mode==='md'}">Markdown</button>
        </div>
        <div class="rte-toolbar" ${draft.mode==='rich'?'':'hidden'}>
          <button type="button" class="rt" data-cmd="bold" title="加粗">B</button>
          <button type="button" class="rt" data-cmd="italic" title="斜体"><i>I</i></button>
          <button type="button" class="rt" data-cmd="underline" title="下划线"><u>U</u></button>
          <button type="button" class="rt" data-cmd="strikeThrough" title="删除线"><s>S</s></button>
          <span class="sep"></span>
          <button type="button" class="rt" data-cmd="h2" title="标题">H2</button>
          <button type="button" class="rt" data-cmd="quote" title="引用">❝</button>
          <button type="button" class="rt" data-cmd="pre" title="代码块">&lt;/&gt;</button>
          <button type="button" class="rt" data-cmd="link" title="链接">${uiIcon('link')}</button>
          <span class="sep"></span>
          ${COLORS.map(c => '<button type="button" class="rt" data-color="' + c + '" title="文字颜色"><span class="dot" style="background:' + c + '"></span></button>').join('')}
          <span class="sep"></span>
          <button type="button" class="rt" data-cmd="removeFormat" title="清除格式">⌫</button>
        </div>
      </details>
      <div id="ed-rich" ${draft.mode==='rich'?'':'hidden'}>
        <div class="rte" id="rte" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="cmp-body-label" data-ph="写下你想分享的内容…"></div>
      </div>
      <div id="ed-md" ${draft.mode==='md'?'':'hidden'}>
        <textarea id="md-ta" placeholder="使用 Markdown 写下你想分享的内容…"></textarea>
      </div>
      <div class="cmp-toolbar">
        <button type="button" class="tb" id="cmp-add-image">图片</button>
        <input type="file" id="cmp-file" accept="image/*" multiple hidden>
        <button type="button" class="tb ${draft.showEmoji?'on':''}" id="cmp-emoji-btn" aria-expanded="${draft.showEmoji}" aria-controls="cmp-emoji">表情</button>
        <span class="cnt" id="cmp-cnt"></span>
      </div>
      <div id="cmp-emoji" ${draft.showEmoji?'':'hidden'}>
        <div class="emoji-panel" style="margin-top:8px">
          ${EMOJIS.map(e => '<button type="button" data-e="' + e + '">' + e + '</button>').join('')}
        </div>
      </div>
      <div id="cmp-imgs" class="cmp-imgs" hidden></div>
      <div>
        <label for="cmp-tag-new">标签 <span class="muted">（可选，最多 3 个）</span></label>
        <div class="cmp-tag-row">
          <span id="cmp-tags" class="tag-inputs"></span>
          <input type="text" id="cmp-tag-new" placeholder="输入标签，回车添加">
        </div>
        <div id="cmp-tag-sug" class="tag-sug" hidden></div>
      </div>
    </div>`;
}
function renderComposerModal(){
  const draft = S.composerDraft;
  const slug = draft.community;
  const daily = slug === 'daily';
  const guideOpen = $('#composer-body .cmp-board-guide')?.open;
  $('#composer-body').innerHTML = `
    <div class="cmp-body">
      <div class="cmp-destination">
        <label for="cmp-community">发布到</label>
        <select id="cmp-community">${communities.map(c => `<option value="${c.slug}" ${slug===c.slug?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
        ${slug === 'market' ? '<button type="button" class="link-btn" id="cmp-rules">交易规则</button>' : ''}
      </div>
      ${slug === 'market' ? `<div id="cmp-market-rules" hidden>${marketRules()}</div>` : ''}
      <details class="cmp-board-guide" ${guideOpen ? 'open' : ''}><summary>${esc(comm(slug).name)} · 发帖提示</summary>${boardGuide(slug)}</details>
      ${daily ? `<details class="editor-options optional-title" ${draft.title ? 'open' : ''}>
        <summary>添加标题（可选）</summary>
        <label class="sr-only" for="cmp-title">标题</label>
        <input type="text" id="cmp-title" maxlength="60" placeholder="给这件小事取个标题">
      </details>` : '<div><label for="cmp-title">标题</label><input type="text" id="cmp-title" maxlength="60" placeholder="用一句话说清这条帖子" autofocus></div>'}
      ${slug === 'resources' ? `
        <div class="cmp-project">
          <label class="cmp-project-toggle"><input type="checkbox" id="cmp-project-toggle" aria-controls="cmp-project-fields" ${draft.projectEnabled ? 'checked' : ''}>作为校园作品发布</label>
          <fieldset id="cmp-project-fields" ${draft.projectEnabled ? '' : 'hidden'}>
            <legend>作品介绍（选填）</legend>
            ${projectFields.map(([key, label, hint]) => `<div>
              <label for="cmp-project-${key}">${label}</label>
              <input type="text" id="cmp-project-${key}" data-project-field="${key}" maxlength="300" placeholder="${hint}">
            </div>`).join('')}
          </fieldset>
        </div>` : ''}
      ${slug === 'market' ? '<div><label for="cmp-price">价格（元）</label><input type="text" id="cmp-price" inputmode="decimal" placeholder="0.00"></div>' : ''}
      ${slug === 'buddies' ? '<div><label for="cmp-when">时间与集合地点</label><input type="text" id="cmp-when" placeholder="如：周六早八点东门集合"></div><div><label for="cmp-meeting-time">活动日期与时间（可选）</label><input type="datetime-local" id="cmp-meeting-time" aria-describedby="cmp-meeting-hint"><small id="cmp-meeting-hint">填写后可计入发现页的近期活动。</small></div>' : ''}
      ${editorBlock(draft)}
    </div>`;
  $('#composer-title').textContent = '发帖';
  const error = $('#cmp-error');
  error.hidden = true;
  $('#cmp-publish-note').textContent = '以 ' + CURRENT_USER + ' 的身份发布';
  $('#cmp-submit').textContent = '发布';
  $('#composer-body').oninput = () => { error.hidden = true; saveDemo(); };
  const projectToggle = $('#cmp-project-toggle');
  if (projectToggle){
    draft.project ||= {};
    projectToggle.onchange = () => {
      draft.projectEnabled = projectToggle.checked;
      $('#cmp-project-fields').hidden = !draft.projectEnabled;
      saveDemo();
    };
    for (const input of document.querySelectorAll('[data-project-field]')){
      const key = input.dataset.projectField;
      input.value = draft.project[key] || '';
      input.oninput = () => { draft.project[key] = input.value; };
    }
  }
  const rulesButton = $('#cmp-rules');
  if (rulesButton){
    rulesButton.setAttribute('aria-expanded','false');
    rulesButton.setAttribute('aria-controls','cmp-market-rules');
    rulesButton.onclick = () => {
      const rules = $('#cmp-market-rules');
      rules.hidden = !rules.hidden;
      rulesButton.setAttribute('aria-expanded', String(!rules.hidden));
    };
  }
  const titleInput = $('#cmp-title');
  for (const [input, key] of [[titleInput, 'title'], [$('#cmp-price'), 'price'], [$('#cmp-when'), 'meeting'], [$('#cmp-meeting-time'), 'meetingTime']]){
    if (!input) continue;
    input.value = draft[key];
    input.oninput = () => { draft[key] = input.value; };
  }
  $('#cmp-community').onchange = e => {
    draft.community = e.target.value;
    saveDemo();
    renderComposerModal();
    $('#cmp-community').focus();
  };
  const tools = $('#cmp-editor-tools');
  tools.ontoggle = () => { draft.showTools = tools.open; };

  /* 编辑器模式切换（双向转换） */
  const rte = $('#rte'), mdTa = $('#md-ta');
  const currentHtml = () => draft.mode === 'rich' ? rte.innerHTML : mdToHtml(mdTa.value);
  const syncEditor = () => {
    if (draft.mode === 'rich') draft.html = rte.innerHTML;
    else draft.md = mdTa.value;
    $('#cmp-cnt').textContent = htmlToText(currentHtml()).length + ' / 2000';
  };
  rte.innerHTML = cleanHtml(draft.html);
  mdTa.value = draft.md;
  rte.oninput = mdTa.oninput = syncEditor;
  $('#mode-md').onclick = () => {
    if (draft.mode === 'md') return;
    draft.md = htmlToMd(rte.innerHTML);
    draft.mode = 'md';
    saveDemo();
    renderComposerModal();
    $('#md-ta').focus();
  };
  $('#mode-rich').onclick = () => {
    if (draft.mode === 'rich') return;
    draft.html = mdTa.value.trim() ? mdToHtml(mdTa.value) : '';
    draft.mode = 'rich';
    saveDemo();
    renderComposerModal();
    $('#rte').focus();
  };
  if (draft.mode === 'rich'){
    $('#composer-body').querySelectorAll('.rte-toolbar .rt').forEach(b => b.onmousedown = e => e.preventDefault());
    $('#composer-body').querySelectorAll('.rte-toolbar .rt').forEach(b => b.onclick = () => {
      rte.focus();
      const cmd = b.dataset.cmd;
      if (b.dataset.color) document.execCommand('foreColor', false, b.dataset.color);
      else if (cmd === 'h2') document.execCommand('formatBlock', false, 'H2');
      else if (cmd === 'quote') document.execCommand('formatBlock', false, 'BLOCKQUOTE');
      else if (cmd === 'pre') document.execCommand('formatBlock', false, 'PRE');
      else if (cmd === 'link'){
        const url = prompt('链接地址（https://…）');
        if (url) document.execCommand('createLink', false, url);
      }
      else document.execCommand(cmd, false, null);
      syncEditor();
      saveDemo();
    });
  }
  syncEditor();

  /* 图片上传 */
  const fileInput = $('#cmp-file');
  $('#cmp-add-image').onclick = () => fileInput.click();
  fileInput.onchange = e => {
    for (const f of e.target.files){
      if (draft.images.length >= 4){
        error.textContent = '最多添加 4 张图片';
        error.hidden = false;
        break;
      }
      draft.images.push(f);
    }
    fileInput.value = '';
    renderImages();
    saveDemo();
  };
  function renderImages(){
    const wrap = $('#cmp-imgs');
    wrap.hidden = !draft.images.length;
    wrap.innerHTML = draft.images.map((src,i) => `<div class="img"><img src="${esc(imageSrc(src))}" alt="待发布图片 ${i+1}"><button type="button" class="rm" data-i="${i}" aria-label="移除图片 ${i+1}">×</button></div>`).join('');
    wrap.querySelectorAll('.rm').forEach(b => b.onclick = () => {
      const [removed] = draft.images.splice(+b.dataset.i, 1);
      URL.revokeObjectURL(imageSrc(removed));
      imageUrls.delete(removed);
      renderImages();
      saveDemo();
      error.hidden = true;
      $('#cmp-add-image').focus({preventScroll:true});
    });
  }
  renderImages();

  /* 表情面板 */
  const emojiButton = $('#cmp-emoji-btn');
  emojiButton.onclick = () => {
    draft.showEmoji = !draft.showEmoji;
    $('#cmp-emoji').hidden = !draft.showEmoji;
    emojiButton.classList.toggle('on', draft.showEmoji);
    emojiButton.setAttribute('aria-expanded', String(draft.showEmoji));
  };
  $('#cmp-emoji').querySelectorAll('button[data-e]').forEach(b =>
    b.onclick = () => {
      if (draft.mode === 'rich'){ rte.focus(); document.execCommand('insertText', false, b.dataset.e); }
      else {
        mdTa.setRangeText(b.dataset.e, mdTa.selectionStart, mdTa.selectionEnd, 'end');
        mdTa.focus();
      }
      syncEditor();
      saveDemo();
    });
  /* 标签：自动补全 + 回车添加 */
  const tagNew = $('#cmp-tag-new'), tagWrap = $('#cmp-tags'), tagSug = $('#cmp-tag-sug');
  tagNew.value = draft.tagInput;
  function renderCmpTags(){
    tagWrap.hidden = !draft.tags.length;
    tagWrap.innerHTML = draft.tags.map((t,i) => `<span class="tag">${esc(t)}<button type="button" data-textrm="${i}" aria-label="移除标签 ${esc(t)}">×</button></span>`).join('');
    tagWrap.querySelectorAll('[data-textrm]').forEach(x => x.onclick = () => {
      draft.tags.splice(+x.dataset.textrm,1);
      renderCmpTags();
      saveDemo();
      tagNew.focus();
    });
  }
  renderCmpTags();
  function addTag(t){
    t = t.trim().replace(/^#/, '');
    if (!t) return;
    if (draft.tags.includes(t) || draft.tags.length >= 3){
      error.textContent = draft.tags.includes(t) ? '标签已存在' : '最多添加 3 个标签';
      error.hidden = false;
      return;
    }
    draft.tags.push(t);
    draft.tagInput = tagNew.value = '';
    tagSug.hidden = true;
    error.hidden = true;
    renderCmpTags();
    saveDemo();
  }
  tagNew.oninput = () => {
    draft.tagInput = tagNew.value;
    const q = tagNew.value.trim().replace(/^#/, '');
    if (!q){ tagSug.hidden = true; return; }
    const sug = [...new Set([...TAG_POOL, ...posts.flatMap(p => p.tags||[])])].filter(t => t.includes(q) && !draft.tags.includes(t)).slice(0,6);
    tagSug.innerHTML = sug.map(t => '<button type="button" data-sug="' + esc(t) + '">' + esc(t) + '</button>').join('');
    tagSug.hidden = !sug.length;
    tagSug.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => { addTag(b.dataset.sug); tagNew.focus(); });
  };
  tagNew.onkeydown = e => {
    if (e.key === 'Enter' && !e.isComposing){ e.preventDefault(); addTag(tagNew.value); }
  };

  /* 发布 */
  $('#cmp-submit').onclick = () => {
    const title = titleInput.value.trim();
    const html = cleanHtml(currentHtml());
    const text = htmlToText(html);
    const needsTitle = !daily && !title;
    const project = slug === 'resources' && draft.projectEnabled
      ? Object.fromEntries(Object.entries(draft.project).map(([key,value]) => [key,value.trim()]).filter(([,value]) => value))
      : null;
    if (needsTitle || (!text && !draft.images.length && !Object.keys(project || {}).length) || text.length > 2000){
      error.textContent = needsTitle ? '请填写标题' : text.length > 2000 ? '正文最多 2000 字' :
        project ? '请填写作品介绍、正文或添加图片' : '请填写正文或添加图片';
      error.hidden = false;
      const editor = draft.mode === 'rich' ? rte : mdTa;
      (needsTitle ? titleInput : editor).focus();
      return;
    }
    const price = draft.price.trim();
    const meeting = draft.meeting.trim();
    const meetingAt = Date.parse(draft.meetingTime);
    const id = 'p' + crypto.randomUUID();
    const shortText = Array.from(text.replace(/\s+/g, ' ').trim());
    const summaryTitle = shortText.length > 32 ? shortText.slice(0,32).join('') + '…' : shortText.join('');
    const tags = daily && draft.images.length && !draft.tags.length ? ['校园随拍'] : draft.tags;
    const p = {
      id, community:slug, author:CURRENT_USER, hoursAgo:0, likes:0,
      title:title || summaryTitle || '校园随拍', excerpt:text, body:text, html,
      ...(draft.images.length ? {images:[...draft.images]} : {}),
      ...(tags.length ? {tags:[...tags]} : {}),
      ...(project ? {project} : {}),
      ...(slug==='market' && price ? {price:'¥'+price} : {}),
      ...(slug==='buddies' && meeting ? {meeting} : {}),
      ...(slug==='buddies' && Number.isFinite(meetingAt) ? {meetingAt} : {}),
    };
    addTopic(p);
    S.composerDraft = null;
    saveDemo();
    $('#composer').close();
    toast('已发布');
    location.hash = '#/posts/' + id;
  };
}

/* ---------- 通知 / 搜索 / 头像 ---------- */
function renderBell(){
  const unread = notifications.filter(n => !S.readNotifications.has(n.id)).length;
  const badge = $('#bell-badge');
  badge.hidden = !unread; badge.textContent = unread;
  $('#bell-drop').innerHTML = `
      <div class="drop-head"><b>通知</b>${unread ? '<button type="button" id="bell-read">全部已读</button>' : ''}</div>
    ${notifications.map(n => {
      const read = S.readNotifications.has(n.id);
      return `<a class="n ${read?'':'unread'}" href="${esc(n.href)}" data-notice="${esc(n.id)}">
        <span class="dot ${read?'read':''}" aria-hidden="true"></span>
        <span class="n-body">${read ? '' : '<span class="sr-only">未读：</span>'}${esc(n.text)}<br><small>${esc(n.detail)} · ${timeAgo(ageOf(n))}</small></span>
      </a>`;
    }).join('')}`;
  $('#bell-drop').querySelectorAll('.n').forEach(el => el.onclick = e => {
    S.readNotifications.add(el.dataset.notice);
    saveDemo();
    $('#bell-drop').hidden = true;
    $('#btn-bell').focus({preventScroll:true});
    renderBell();
    if (location.hash === el.hash){
      e.preventDefault();
      route({navigate:true});
    }
  });
  const rb = $('#bell-read');
  if (rb) rb.onclick = () => {
    notifications.forEach(n => S.readNotifications.add(n.id));
    saveDemo();
    renderBell();
    $('#bell-drop .n')?.focus();
  };
}
function renderAvatarDrop(){
  $('#avatar-drop').innerHTML = `
    <div class="drop-head"><b>林同学</b><span class="muted" style="font-size:12px">${uiIcon('check')} 同校认证</span></div>
    <div class="n" data-go="#/me"><div class="n-body">${uiIcon('user')} 个人主页</div></div>
    <div class="n" data-go="#/inbox"><div class="n-body">${uiIcon('inbox')} 私信</div></div>
    <div class="n" data-go="#/discover"><div class="n-body">${uiIcon('compass')} 发现</div></div>
    <div class="n" data-go="#/settings"><div class="n-body">${uiIcon('settings')} 设置</div></div>
    <div class="n" id="logout"><div class="n-body">${uiIcon('log-out')} 退出登录</div></div>`;
  $('#avatar-drop').querySelectorAll('.n[data-go]').forEach(el => el.onclick = () => {
    $('#avatar-drop').hidden = true; location.hash = el.dataset.go;
  });
  $('#logout').onclick = () => { $('#avatar-drop').hidden = true; toast('演示：退出登录'); };
}
/* ---------- 路由与事件 ---------- */
function route({navigate = false} = {}){
  if (navigate){
    flushReading();
    $('#search-drop').hidden = true;
  }
  wikiTocObserver?.disconnect();
  const [path, anchor] = location.hash.slice(1).split('#', 2);
  const [pathname, query] = path.split('?', 2);
  const parts = pathname.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const post = parts[0] === 'posts' && posts.find(p => p.id === parts[1]);
  const postAnchor = anchor || (post && params.get('thread') ? 'comments' : undefined);
  const listView = navigate ? enterPage(parts, post) : null;
  const reading = navigate && post && S.reading.get(post.id);
  $('#composer-bar').hidden = !post;
  const isWikiPage = parts[0] === 'wiki' || (parts[0] === 'c' && parts[2] === 'wiki');
  document.body.classList.toggle('wiki-page', isWikiPage);
  if (!parts.length){ renderHome(); renderRail('home'); }
  else if (parts[0] === 'discover'){ renderDiscover(); renderRail('page'); }
  else if (parts[0] === 'search'){ renderSearch(params); renderRail('me'); }
  else if (parts[0] === 'inbox'){ renderInbox(parts[1], params); renderRail('me'); }
  else if (parts[0] === 'bookmarks' || parts[0] === 'recommended'){ renderBookmarks(); renderRail('me'); }
  else if (parts[0] === 'me'){ renderMe(); renderRail('me'); }
  else if (parts[0] === 'users' && parts[1]){ renderUser(decodeURIComponent(parts[1])); renderRail('me'); }
  else if (parts[0] === 'settings'){ renderSettings(); renderRail('me'); }
  else if (parts[0] === 'c' && parts[1]){ renderCommunity(parts[1], parts[2], params.get('topic')); renderRail('page', comm(parts[1])); }
  else if (post){ renderPost(post.id, navigate ? postAnchor || reading?.anchor : undefined); renderRail('post'); }
  else if (parts[0] === 'tag' && parts[1]){ renderTag(decodeURIComponent(parts[1])); renderRail('page'); }
  else if (parts[0] === 'wiki' && parts[1]){ renderWikiArticle(parts[1], anchor); renderRail('me'); }
  else if (parts[0] === 'wiki'){ renderWiki(); renderRail('page'); }
  else { renderHome(); renderRail('home'); }
  if (isWikiPage) $('#rail').innerHTML = '';
  renderSidebar();
  const pb = document.getElementById('progress');
  if (pb) pb.style.display = post ? 'block' : 'none';
  if (navigate){
    $('#sidebar').classList.remove('open');
    $('#menu-btn').setAttribute('aria-expanded', 'false');
    const wikiHeading = parts[0] === 'wiki' && anchor?.startsWith('ws-') && document.getElementById(anchor);
    if (post && postAnchor) focusPostAnchor(postAnchor);
    else if (wikiHeading) focusContent(wikiHeading);
    else if (reading) resumeReading(reading);
    else if (listView) window.scrollTo({top:listView.y, behavior:'instant'});
    else window.scrollTo({top:0, behavior:'instant'});
  }
  if (post) rememberReading();
}

document.addEventListener('click', e => {
  const like = e.target.closest('.like-post');
  if (like){
    const id = like.dataset.id;
    const post = posts.find(p => p.id === id);
    const liked = S.likes.has(id);
    if (liked) S.likes.delete(id);
    else S.likes.add(id);
    saveDemo();
    if (S.meTab === 'likes' && location.hash === '#/me'){
      renderMe();
      $('.profile-tabs .on').focus({preventScroll:true});
      return;
    }
    document.querySelectorAll(`.like-post[data-id="${CSS.escape(id)}"]`).forEach(button => {
      button.classList.toggle('liked', !liked);
      button.setAttribute('aria-pressed', String(!liked));
      button.querySelector('.cnt').textContent = postScore(post);
    });
    const railScore = document.querySelector(`[data-rail-score="${CSS.escape(id)}"]`);
    if (railScore) railScore.textContent = postScore(post) + ' 赞';
    return;
  }
  const bmk = e.target.closest('[data-bmk]');
  if (bmk){
    const id = bmk.dataset.bmk;
    if (S.bookmarks.has(id)){ S.bookmarks.delete(id); toast('已取消收藏'); }
    else { S.bookmarks.add(id); toast('已收藏，可在侧栏「收藏」找到'); }
    saveDemo();
    route();
    document.querySelector(`[data-bmk="${id}"]`)?.focus({preventScroll:true});
    return;
  }
  const fl = e.target.closest('[data-follow]');
  if (fl){
    const id = fl.dataset.follow;
    if (S.follows.has(id)){ S.follows.delete(id); toast('已取消关注'); }
    else { S.follows.add(id); toast('已关注，更新会出现在「我关注的」'); }
    saveDemo();
    route(); return;
  }
  const st = e.target.closest('.share-toggle');
  if (st){
    const drop = st.parentElement.querySelector('.share-drop');
    drop.hidden = !drop.hidden;
    st.setAttribute('aria-expanded', String(!drop.hidden));
    return;
  }
  const sh = e.target.closest('[data-share]');
  if (sh){
    sh.closest('.share-drop').hidden = true;
    const toggle = sh.closest('.share-wrap').querySelector('.share-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus({preventScroll:true});
    if (sh.dataset.share === 'copy') copyLink('#/posts/' + $('.post-card').dataset.topic);
    else if (sh.dataset.share === 'poster') toast('演示：生成分享海报图');
    else location.hash = inboxHref('', $('.post-card').dataset.topic);
    return;
  }
  const cl = e.target.closest('.clike');
  if (cl){
    const key = cl.dataset.id;
    const liked = S.commentLikes.has(key);
    if (liked) S.commentLikes.delete(key);
    else S.commentLikes.add(key);
    saveDemo();
    cl.classList.toggle('liked', !liked);
    cl.setAttribute('aria-pressed', String(!liked));
    const count = cl.querySelector('.cnt');
    count.textContent = Number(count.textContent) + (liked ? -1 : 1);
    return;
  }
  const copyReply = e.target.closest('[data-copy-reply]');
  if (copyReply){ copyLink(copyReply.dataset.copyReply); return; }
  const cr = e.target.closest('.creply');
  if (cr){
    const id = $('.post-card').dataset.topic;
    renderComposerBar(posts.find(p => p.id === id), { id:cr.dataset.id, name:cr.dataset.name, body:cr.dataset.body });
    saveDemo();
    return;
  }
  const cb = e.target.closest('.cbest');
  if (cb){
    const post = posts.find(p => p.id === $('.post-card')?.dataset.topic);
    const replyId = cb.dataset.id;
    if (!canAcceptReply(post) || !comments[post.id]?.some(reply => reply.id === replyId)) return;
    if (S.best[post.id] === replyId) delete S.best[post.id];
    else S.best[post.id] = replyId;
    if (post.wikiRef?.answerId && post.wikiRef.answerId !== S.best[post.id]) delete post.wikiRef;
    saveDemo();
    renderPost(post.id);
    document.getElementById('cm-' + replyId)?.querySelector('.cbest')?.focus({preventScroll:true});
    toast(isSolved(post) ? '已采纳为最佳回复' : '已取消采纳');
    return;
  }
  const tf = e.target.closest('[data-tagfollow]');
  if (tf){
    const t = tf.dataset.tagfollow;
    if (S.tagFollows.has(t)){ S.tagFollows.delete(t); toast('已取消关注 #' + t); }
    else { S.tagFollows.add(t); toast('已关注 #' + t + '，更新会出现在「我关注的」'); }
    saveDemo();
    route(); return;
  }
  const fold = e.target.closest('.fold');
  if (fold && fold.dataset.parent){
    S.openReplies.add(fold.dataset.parent);
    route();
    focusPostAnchor('cm-' + fold.dataset.next);
    return;
  }
  const vb = e.target.closest('[data-view]');
  if (vb){
    S.view = vb.dataset.view;
    route();
    $('.view-controls .on').focus({preventScroll:true});
    return;
  }
  const ex = e.target.closest('[data-expand]');
  if (ex){ S.expandedPosts.has(ex.dataset.expand) ? S.expandedPosts.delete(ex.dataset.expand) : S.expandedPosts.add(ex.dataset.expand); route(); return; }
  const cb2 = e.target.closest('[data-collapse]');
  if (cb2){
    const key = cb2.dataset.collapse;
    if (S.collapsedComments.has(key)){
      S.collapsedComments.delete(key);
      S.openReplies.add(key);
    } else S.collapsedComments.add(key);
    route();
    document.querySelector(`[data-collapse="${CSS.escape(key)}"]`)?.focus({preventScroll:true});
    return;
  }
  if (!e.target.closest('.share-wrap')){
    const drop = $('.share-drop');
    if (drop){
      drop.hidden = true;
      $('.share-toggle').setAttribute('aria-expanded', 'false');
    }
  }
});

window.addEventListener('hashchange', () => route({navigate:true}));

$('#btn-new').onclick = () => openComposer();
$('#btn-bell').onclick = e => {
  e.stopPropagation();
  const d = $('#bell-drop'); d.hidden = !d.hidden;
  if (!d.hidden) renderBell();
};
$('#btn-avatar').onclick = e => {
  e.stopPropagation();
  const d = $('#avatar-drop'); d.hidden = !d.hidden;
  if (!d.hidden) renderAvatarDrop();
};
$('#menu-btn').onclick = () => {
  const open = $('#sidebar').classList.toggle('open');
  $('#menu-btn').setAttribute('aria-expanded', String(open));
};
const composer = $('#composer');
$('#composer-close').onclick = $('#cmp-later').onclick = () => composer.close();
composer.onclick = e => { if (e.target === composer) composer.close(); };
$('#search-input').addEventListener('input', e => { S.searchQ = e.target.value; renderSearchDrop(); });
$('#search-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') $('#search-drop').hidden = true;
  if (e.key !== 'Enter' || e.isComposing) return;
  const query = e.target.value.trim();
  if (!query) return;
  e.preventDefault();
  $('#search-drop').hidden = true;
  location.hash = searchHref(query);
});

/* 阅读进度条（Discourse 时间线的轻量替代） */
const PROG = document.createElement('div');
PROG.id = 'progress';
PROG.style.display = 'none';
document.body.appendChild(PROG);
window.addEventListener('scroll', () => {
  if (!location.hash.startsWith('#/posts/')){ PROG.style.width = '0'; return; }
  const h = document.documentElement;
  const max = h.scrollHeight - h.clientHeight;
  PROG.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
  rememberReading();
});
window.addEventListener('pagehide', () => { rememberReading(); flushReading(); });
history.scrollRestoration = 'manual';
document.addEventListener('click', e => {
  if (!e.target.closest('#search')) $('#search-drop').hidden = true;
  if (!e.composedPath().includes($('.bell-wrap'))) $('#bell-drop').hidden = true;
  if (!e.target.closest('.avatar-wrap')) $('#avatar-drop').hidden = true;
});

document.body.inert = true;
restoreDemo().then(() => {
  // Migrate the demo's old anonymous sample and saved posts to named accounts.
  for (const post of posts){
    if (post.author === '匿名用户' || post.author === '匿名') post.author = post.id === 'p4' ? '夜猫同学' : CURRENT_USER;
    delete post.anonymous;
  }
  for (const item of [...posts, ...Object.values(comments).flat(), ...notifications]){
    item.createdAt ??= NOW - item.hoursAgo * HOUR;
  }
  renderBell();
  initializeWiki();
  document.body.inert = false;
  route({navigate:true});
});
