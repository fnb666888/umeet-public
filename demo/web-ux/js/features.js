const HOUR = 3600000;
const marketRulesHref = '#/c/market/rules';
const contacts = [
  {id:'graduate', name:'毕业学长K'},
  {id:'hiker', name:'跑步机上的鱼'},
  {id:'silver', name:'一只银杏'},
];
const demoThreads = [{
  peer:'graduate', unread:true,
  messages:[{incoming:true, text:'你好，iPad 可以在东门快递柜旁当面验机。', postId:'p3'}],
}];
const isForSale = post => post.community === 'market' && !post.sold;
const isUpcoming = post => post.community === 'buddies' &&
  post.meetingAt >= Date.now() && post.meetingAt <= Date.now() + 7 * 24 * HOUR;
const ageOf = item => item.createdAt == null ? item.hoursAgo : (Date.now() - item.createdAt) / HOUR;
const lastActivity = post => Math.max(post.createdAt, latestReply(post)?.createdAt ?? 0);
const followsPost = post => S.follows.has(post.id) || (post.tags || []).some(tag => S.tagFollows.has(tag));
const boardGuides = {
  daily:['分享校园里的见闻、照片或小故事。','发照片前留意画面里的同学和个人信息。'],
  questions:['标题写清问题，正文补上地点、时间和已试过的方法。','找到答案后，可以采纳回复或追加进展。'],
  market:['写明物品成色、价格和校内交接地点。','当面验货再付款，成交后标记已出。'],
  treehole:['聊聊自己的经历和感受。','尊重他人，省略可识别他人的细节。'],
  buddies:['写明活动时间、集合地点和参与条件。','有变更时可以在原帖追加进展。'],
  resources:['附上资料来源、适用课程或使用说明。','原创作品可以选择「校园作品」，补充体验方式。'],
};
function boardGuide(slug){
  return `<ul class="board-guide">${boardGuides[slug].map(line => `<li>${line}</li>`).join('')}</ul>`;
}
const currentThreadId = () => new URLSearchParams(location.hash.split('#')[1]?.split('?')[1]).get('thread');

async function copyLink(href){
  const url = new URL(href, location.href).href;
  try {
    await navigator.clipboard.writeText(url);
    toast('链接已复制');
  } catch {
    prompt('复制链接', url);
  }
}

const projectFields = [
  ['work', '做了什么', '它解决了哪个校园里的小问题？'],
  ['access', '怎么体验', '体验链接或使用步骤'],
  ['feedback', '想听什么反馈', '最想请同学帮忙看什么？'],
];
const isCampusProject = post => post.community === 'resources' &&
  Boolean(post.project || post.tags?.includes('校园作品'));

function projectDetails(post){
  if (!post.project) return '';
  const fields = projectFields.filter(([key]) => post.project[key]);
  if (!fields.length) return '';
  return `<dl class="project-details">${fields.map(([key,label]) => {
    const value = post.project[key];
    const link = key === 'access' && /^https?:\/\/\S+$/i.test(value);
    return `<div><dt>${label}</dt><dd>${link ? `<a href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>` : esc(value)}</dd></div>`;
  }).join('')}</dl>`;
}
const replyHref = (post, reply) => '#/posts/' + post.id + '#cm-' + reply.id;
const replyAuthor = (post, reply) => reply.author;
const replyPreview = reply => reply.body || (reply.image ? '图片回复' : '');

function latestReply(post){
  return (comments[post.id] || []).reduce((latest, reply) =>
    !latest || reply.createdAt >= latest.createdAt ? reply : latest, null);
}

function latestReplyLink(post, reply){
  return `<a class="latest-reply" href="${replyHref(post, reply)}">
    <span>最后回复</span> <strong>${esc(replyAuthor(post, reply))}</strong>
    <time datetime="${new Date(reply.createdAt).toISOString()}">${timeAgo(ageOf(reply))}</time>
  </a>`;
}

function dailyConversation(posts){
  const recent = posts.filter(post => post.community === 'daily')
    .flatMap(post => (comments[post.id] || []).map(reply => ({post, reply})))
    .sort((a,b) => b.reply.createdAt - a.reply.createdAt)
    .slice(0,3);
  if (!recent.length) return '';
  return `<section class="card daily-conversation" aria-labelledby="daily-conversation-title">
    <div class="daily-conversation-head">
      <h2 id="daily-conversation-title">大家在聊</h2>
      <a href="#/c/daily" class="link-btn">校园日常</a>
    </div>
    <ul>${recent.map(({post, reply}) => `<li><a href="${replyHref(post, reply)}">
      <span class="daily-reply-context"><strong>${esc(replyAuthor(post, reply))}</strong> <time>${timeAgo(ageOf(reply))}</time></span>
      <span class="daily-reply-preview">${esc(replyPreview(reply))}</span>
      <span class="daily-reply-topic">${esc(post.title)}</span>
    </a></li>`).join('')}</ul>
  </section>`;
}

function relatedTopics(post){
  const tags = new Set(post.tags || []);
  return posts.filter(candidate => candidate.id !== post.id)
    .map(candidate => ({
      candidate,
      sharedTags:(candidate.tags || []).filter(tag => tags.has(tag)).length,
      sameBoard:candidate.community === post.community,
    }))
    .filter(match => match.sharedTags || match.sameBoard)
    .sort((a,b) => b.sharedTags - a.sharedTags || Number(b.sameBoard) - Number(a.sameBoard)
      || lastActivity(b.candidate) - lastActivity(a.candidate))
    .slice(0,3).map(match => match.candidate);
}

function marketStatus(post){
  return post.community === 'market'
    ? `<span class="post-status market-status ${post.sold?'is-sold':'is-available'}">${post.sold ? uiIcon('circle-minus') : '<span class="status-dot" aria-hidden="true"></span>'}${post.sold?'已出':'在售'}</span>`
    : '';
}

function marketRules(){
  return `<article class="card wiki-prose">
    <h2>校园二手交易规则</h2>
    <p>发帖时写清价格、物品成色和已知问题。请通过私信约定面交地点，避免在公开帖里留下联系方式。</p>
    <p>建议约在校园公共区域，验货后再付款。交易结束后由卖家标记「已出」，原帖可继续查阅。</p>
  </article>`;
}

function addNotice(text, detail, href){
  notifications.unshift({id:'n' + crypto.randomUUID(), text, detail, href, createdAt:Date.now()});
  renderBell();
}

function addTopic(post){
  post.createdAt = Date.now();
  posts.unshift(post);
  comments[post.id] = [];
  const matchedTags = (post.tags || []).filter(tag => S.tagFollows.has(tag));
  if (notifPrefs.follow && post.author !== CURRENT_USER && matchedTags.length){
    addNotice('关注的标签有新帖', '#' + matchedTags.join(' #') + ' · ' + post.title, '#/posts/' + post.id);
  }
}

function addReply(post, reply){
  reply.createdAt = Date.now();
  (comments[post.id] ||= []).push(reply);
  if (notifPrefs.follow && reply.author !== CURRENT_USER && followsPost(post)){
    addNotice('关注的帖子有新回复', post.title, replyHref(post, reply));
  }
}

function simulateFollowActivity(){
  const post = posts.find(p => S.follows.has(p.id));
  const tag = S.tagFollows.values().next().value;
  if (post){
    addReply(post, {id:'c' + crypto.randomUUID(), author:'一只银杏', hoursAgo:0, likes:0,
      body:'我也在关注这个话题，有新进展欢迎补充。'});
  }
  if (tag){
    addTopic({id:'p' + crypto.randomUUID(), author:'一只银杏', community:'daily', hoursAgo:0, likes:0,
      title:'关于「' + tag + '」的校园近况', body:'欢迎在这里交流最近的校园消息。', tags:[tag]});
  }
  saveDemo();
  route();
  toast('已生成同学动态');
}

let readingTimer;
function unreadReplies(post){
  const record = S.reading.get(post.id);
  if (!record) return [];
  return (comments[post.id] || []).filter(reply => reply.author !== CURRENT_USER && !record.seen.has(reply.id));
}

function unreadLink(post){
  const replies = unreadReplies(post);
  if (!replies.length) return '';
  return `<a class="unread-replies" href="${replyHref(post, replies[0])}">${replies.length} 条新回复</a>`;
}

function rememberReading(){
  const topic = $('.post-card')?.dataset.topic;
  if (!topic) return;
  let record = S.reading.get(topic);
  if (!record){
    record = {y:0, seen:new Set((comments[topic] || []).map(reply => reply.id))};
    S.reading.set(topic, record);
  }
  const top = $('.topbar').getBoundingClientRect().bottom;
  const bottom = $('#composer-bar').getBoundingClientRect().top;
  const replies = [...document.querySelectorAll('#cmts .comment')];
  let nearest;
  for (const reply of replies){
    const y = reply.getBoundingClientRect().top;
    if (y >= top && y + 24 < bottom) record.seen.add(reply.id.slice(3));
    if (y < bottom && (!nearest || Math.abs(y - top) < Math.abs(nearest.y - top))){
      nearest = {id:reply.id, y};
    }
  }
  if (!currentThreadId()){
    record.y = window.scrollY;
    record.anchor = nearest?.id;
    record.offset = nearest?.y;
  }
  clearTimeout(readingTimer);
  readingTimer = setTimeout(flushReading, 160);
}

function flushReading(){
  if (!readingTimer) return;
  clearTimeout(readingTimer);
  readingTimer = undefined;
  saveDemo();
}

function resumeReading(record){
  const reply = record.anchor && document.getElementById(record.anchor);
  const top = reply ? window.scrollY + reply.getBoundingClientRect().top - record.offset : record.y;
  window.scrollTo({top, behavior:'instant'});
}

let navigationPage;
const listViews = new Map();

function listLabel(parts){
  switch (parts[0]){
    case undefined: return '首页';
    case 'c': return comm(parts[1])?.name;
    case 'tag': return '标签列表';
    case 'search': return '搜索结果';
    case 'discover': return '发现';
    case 'bookmarks':
    case 'recommended': return '收藏';
    case 'me': return '个人主页';
    case 'users': return decodeURIComponent(parts[1]) + '的主页';
  }
}

function enterPage(parts, post){
  const previous = navigationPage;
  if (previous?.label){
    const controls = {view:S.view};
    if (!previous.parts.length) controls.feedSort = S.feedSort;
    if (previous.parts[0] === 'me') controls.meTab = S.meTab;
    const board = previous.parts[0] === 'c' ? previous.parts[1] : null;
    if (board === 'questions') controls.questionFilter = S.questionFilter;
    if (board === 'market') controls.marketFilter = S.marketFilter;
    listViews.set(previous.id, {y:window.scrollY, controls, board, sort:S.boardSort.get(board)});
  }

  let entry = history.state?.umeetNavigation;
  if (!entry){
    const origin = post && previous?.label
      ? {id:previous.id, index:previous.index, href:previous.href, label:previous.label}
      : post ? previous?.origin : null;
    entry = {id:crypto.randomUUID(), index:(previous?.index ?? -1) + 1, origin};
    history.replaceState({...history.state, umeetNavigation:entry}, '');
  }
  navigationPage = {...entry, parts, href:location.hash || '#/', label:listLabel(parts)};
  const view = listViews.get(entry.id);
  if (view && previous?.origin?.id === entry.id){
    Object.assign(S, view.controls);
    if (view.board) S.boardSort.set(view.board, view.sort || 'activity');
  }
  return view || null;
}

function returnToPostList(event){
  const origin = navigationPage?.origin;
  if (!origin || !listViews.has(origin.id) || event.button || event.ctrlKey ||
      event.metaKey || event.shiftKey || event.altKey) return;
  const offset = origin.index - navigationPage.index;
  if (offset >= 0) return;
  event.preventDefault();
  history.go(offset);
}

function searchHref(query, type = 'all', board = ''){
  const params = new URLSearchParams({q:query});
  if (type !== 'all') params.set('type', type);
  if (board) params.set('board', board);
  return '#/search?' + params;
}

const searchTypes = [['all','全部'], ['posts','帖子'], ['wiki','词条'], ['tags','标签']];
function searchMatches(query, board){
  const key = query.replace(/^#\s*/, '').trim().toLowerCase();
  const matches = value => String(value || '').toLowerCase().includes(key);
  const topics = board ? posts.filter(post => post.community === board) : posts;
  const articles = board ? wikiForCommunity(board) : wiki;
  return {
    posts:key ? topics.filter(p => [p.title, p.body, p.meeting, ...(p.tags || []),
      ...Object.values(p.project || {}), ...(p.updates || []).map(update => update.body),
      isCampusProject(p) ? '校园作品' : ''].some(matches)) : [],
    wiki:key ? articles.filter(w => [w.title, w.summary, ...(wikiGuides[w.id]?.aliases || []), ...w.sections.map(s => s.h + ' ' + s.p)].some(matches)) : [],
    tags:key ? [...new Set(topics.flatMap(p => p.tags || []))].filter(matches) : [],
  };
}

function searchHits(matches){
  return [
    ...matches.posts.map(p => ({href:'#/posts/' + p.id, title:p.title, label:'帖子 · ' + comm(p.community).name})),
    ...matches.wiki.map(w => ({href:'#/wiki/' + w.id, title:w.title, label:'词条 · ' + wikiDate(w) + '更新'})),
    ...matches.tags.map(tag => ({href:'#/tag/' + encodeURIComponent(tag), title:'# ' + tag, label:'标签'})),
  ];
}

function renderSearchDrop(){
  const query = S.searchQ.trim();
  const drop = $('#search-drop');
  drop.hidden = !query;
  if (!query) return;
  const {posts, wiki, tags} = searchMatches(query);
  const hits = searchHits({posts:posts.slice(0,4), wiki:wiki.slice(0,3), tags:tags.slice(0,2)});
  drop.innerHTML = hits.map(hit => `<a class="hit" href="${esc(hit.href)}"><b>${esc(hit.title)}</b><small>${esc(hit.label)}</small></a>`).join('') +
    (hits.length ? '' : '<p class="search-hint">未找到匹配内容</p>') +
    `<a class="hit search-all" href="${esc(searchHref(query))}">搜索「${esc(query)}」</a>`;
}

function renderSearch(params){
  const query = (params.get('q') || '').trim();
  const selected = params.get('type');
  const type = searchTypes.some(([id]) => id === selected) ? selected : 'all';
  const board = comm(params.get('board'));
  const matches = searchMatches(query, board?.slug);
  const hits = searchHits(type === 'all' ? matches : {posts:[], wiki:[], tags:[], [type]:matches[type]});
  S.searchQ = $('#search-input').value = query;
  $('#main').innerHTML = `<div class="page-head"><h1>搜索结果</h1></div>
    <p class="result-summary">${query ? `「${esc(query)}」 · ${hits.length} 条结果` : '在顶栏输入关键词搜索。'}</p>
    ${board ? `<p class="search-scope"><span>范围 · ${esc(board.name)}</span>
      <a class="link-btn" href="${esc(searchHref(query,type))}">搜索全站</a></p>` : ''}
    <nav class="tabs community-tabs" aria-label="搜索结果分类">
      ${searchTypes.map(([key,label]) => `<a href="${esc(searchHref(query,key,board?.slug))}" ${key===type?'aria-current="page"':''}>${label}</a>`).join('')}
    </nav>
    ${hits.length ? `<div class="card search-results">${hits.map(hit => `<a href="${esc(hit.href)}"><b>${esc(hit.title)}</b><small>${esc(hit.label)}</small></a>`).join('')}</div>`
      : '<p class="empty">没有匹配的结果，试试其他关键词或分类。</p>'}`;
}

function inboxHref(peer = '', postId = ''){
  return '#/inbox' + (peer ? '/' + peer : '') + (postId ? '?' + new URLSearchParams({post:postId}) : '');
}

function renderInbox(peerId, params){
  const contact = contacts.find(peer => peer.id === peerId);
  const ref = posts.find(post => post.id === params.get('post'));
  const thread = S.threads.find(item => item.peer === peerId);
  if (thread?.unread){ thread.unread = false; saveDemo(); }
  const reference = post => `<a class="message-ref" href="#/posts/${post.id}">${esc(post.title)}</a>`;
  $('#main').innerHTML = `<div class="page-head"><h1>私信</h1></div>
    <div class="inbox-layout">
      <nav class="card inbox-contacts" aria-label="同学会话">
        ${contacts.map(peer => `<a href="${esc(inboxHref(peer.id, ref?.id))}" ${peer===contact?'aria-current="page"':''}>${esc(peer.name)}
          ${S.threads.some(item => item.peer === peer.id && item.unread) ? '<span class="unread-dot" aria-label="有未读消息"></span>' : ''}</a>`).join('')}
      </nav>
      <section class="card inbox-chat">
        <h2>${contact ? esc(contact.name) : '选择一位同学'}</h2>
        ${thread?.messages.length ? `<ol class="messages">${thread.messages.map(message => {
          const post = posts.find(item => item.id === message.postId);
          return `<li class="${message.incoming?'incoming':'outgoing'}"><span class="sr-only">${message.incoming ? esc(contact.name) : '我'}</span>
            ${message.text ? `<p>${esc(message.text)}</p>` : ''}${post ? reference(post) : ''}</li>`;
        }).join('')}</ol>` : '<p class="muted">暂无消息</p>'}
        ${ref ? `<p class="message-preview">待发送的帖子 ${reference(ref)} <a class="link-btn" href="${inboxHref(peerId)}">移除</a></p>` : ''}
        ${contact ? `<form id="message-form">
          <label class="sr-only" for="message-text">消息内容</label>
          <textarea id="message-text" maxlength="500" placeholder="写一条消息…"></textarea>
          <button class="btn-primary" type="submit">发送</button>
        </form>` : ''}
      </section>
    </div>`;
  const form = $('#message-form');
  if (!form) return;
  form.onsubmit = e => {
    e.preventDefault();
    const text = $('#message-text').value.trim();
    if (!text && !ref){ $('#message-text').focus(); return; }
    const target = thread || {peer:contact.id, unread:false, messages:[]};
    if (!thread) S.threads.push(target);
    target.messages.push({text, postId:ref?.id});
    saveDemo();
    if (ref) location.hash = inboxHref(contact.id);
    else { renderInbox(peerId, params); $('#message-text').focus(); }
  };
}

function renderBookmarks(){
  const saved = [...S.bookmarks].reverse().map(id => posts.find(post => post.id === id)).filter(Boolean);
  $('#main').innerHTML = `<div class="page-head"><h1>收藏</h1></div>
    <p class="result-summary">你收藏的内容，方便随时回来查看。共 ${saved.length} 条。</p>
    ${saved.length ? saved.map(post => feedCard(post)).join('') : '<div class="empty">还没有收藏的内容。看到想留着的帖子，点击收藏就会出现在这里。<p><a href="#/">去首页看看</a></p></div>'}`;
}
