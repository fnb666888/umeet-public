'use client';
import { navigateCommunity } from '../../lib/community-route';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useCommunity } from './store';
import { Icon } from './Icon';
import { inboxHref, postHref } from './model';
import {
  messageApi,
  messageResources,
  useMessages,
  type Conversation,
  type Message,
  type MessagePage,
} from './messaging';
import { ToolbarPopover } from './ToolbarPopover';
import { ReportButton } from './Governance';

function time(value: string | null) {
  if (!value) return '';
  const date = new Date(value),
    today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
function Avatar({ person }: { person: { name: string; avatar?: string } }) {
  return (
    <span className="dm-avatar">
      {person.avatar ? <img src={person.avatar} alt="" /> : person.name.slice(0, 1)}
    </span>
  );
}
export function Inbox({ peer, params }: { peer?: string | undefined; params: URLSearchParams }) {
  const { data, toast } = useCommunity();
  const { summary, view, setView, refresh, more, error, loading } = useMessages();
  const [filter, setFilter] = useState('');
  const [find, setFind] = useState(false);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [searchError, setSearchError] = useState('');
  const [settings, setSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allowRequests, setAllowRequests] = useState(summary.allowRequests);
  useEffect(() => setAllowRequests(summary.allowRequests), [summary.allowRequests]);
  useEffect(() => {
    setPeople([]);
    setSearchError('');
    if (!find || query.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      void messageApi<{ id: string; name: string }[]>('/users?q=' + encodeURIComponent(query))
        .then((result) => {
          if (active) setPeople(result);
        })
        .catch((e) => {
          if (active) setSearchError((e as Error).message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, find]);
  const list = summary.conversations.filter(
    (c) =>
      !filter ||
      c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.lastMessage?.text.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className={'dm-page' + (peer ? ' dm-has-peer' : '')} aria-label="私信">
      <header className="dm-page-heading">
        <h1>私信</h1>
        <button
          className="link-btn"
          onClick={() => setSettings(!settings)}
          aria-expanded={settings}
        >
          私信设置
        </button>
      </header>
      {settings && (
        <div className="dm-settings">
          <label>
            <input
              type="checkbox"
              checked={allowRequests}
              disabled={saving}
              onChange={async (e) => {
                const value = e.target.checked;
                setAllowRequests(value);
                setSaving(true);
                try {
                  await messageApi('/preferences', { allowRequests: value });
                  await refresh();
                } catch (failure) {
                  setAllowRequests(summary.allowRequests);
                  toast((failure as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            />
            允许其他用户发送新的私信请求
          </label>
          <p>已有会话可以继续交流。首次联系将进入消息请求。</p>
        </div>
      )}
      <div className="dm-layout">
        <aside className="dm-sidebar" aria-label="会话列表">
          <div className="dm-list-heading">
            <strong>{find ? '发起私信' : '最近会话'}</strong>
            <button
              className="icon-btn"
              aria-label={find ? '返回会话' : '新私信'}
              onClick={() => {
                setFind(!find);
                setQuery('');
              }}
            >
              <Icon name={find ? 'x' : 'plus'} />
            </button>
          </div>
          {find ? (
            <div className="dm-find">
              <label className="sr-only" htmlFor="dm-user-search">
                搜索用户名
              </label>
              <input
                autoFocus
                id="dm-user-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入用户名，至少 2 个字符"
                maxLength={32}
              />
              <p className="dm-hint">也可以从对方主页或帖子发起私信。</p>
              {searchError && <p role="alert">{searchError}</p>}
              {people.map((person) => (
                <a
                  key={person.id}
                  href={inboxHref(person.id, params.get('post') || '')}
                  onClick={() => {
                    setFind(false);
                    setView('messages');
                  }}
                >
                  <Avatar person={person} />
                  <span>{person.name}</span>
                </a>
              ))}
              {query.trim().length >= 2 && !people.length && !searchError && (
                <p className="dm-hint">没有匹配的用户</p>
              )}
            </div>
          ) : (
            <>
              <div className="dm-list-search">
                <Icon name="search" />
                <input
                  aria-label="搜索会话"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="搜索会话"
                />
              </div>
              <nav className="dm-tabs" aria-label="会话筛选">
                {(
                  [
                    ['messages', '消息'],
                    ['unread', '未读'],
                    ['requests', '请求'],
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
                    {label}
                    {key === 'requests' && summary.requests > 0 && <span>{summary.requests}</span>}
                  </button>
                ))}
              </nav>
              {error && (
                <div className="dm-list-error" role="alert">
                  <p>{error}</p>
                  <button className="link-btn" onClick={() => void refresh()}>
                    重新加载
                  </button>
                </div>
              )}
              <nav className="dm-conversation-list" aria-label="最近会话">
                {list.map((c) => (
                  <a
                    key={c.peer}
                    href={inboxHref(c.peer)}
                    aria-current={peer === c.peer ? 'page' : undefined}
                  >
                    <Avatar person={c} />
                    <div className="dm-conversation-copy">
                      <div>
                        <strong>{c.name}</strong>
                        <time dateTime={c.updatedAt || undefined}>{time(c.updatedAt)}</time>
                      </div>
                      <p>
                        {c.blocked
                          ? '已拉黑'
                          : c.status === 'pending' && !c.incomingRequest
                            ? '[等待接受] '
                            : ''}
                        {c.lastMessage?.text || (c.lastMessage?.postId ? '[帖子]' : '暂无消息')}
                      </p>
                    </div>
                    <div className="dm-conversation-badges">
                      {c.muted && (
                        <span title="已免打扰" aria-label="已免打扰">
                          静音
                        </span>
                      )}
                      {c.unread > 0 && (
                        <b aria-label={c.unread + ' 条未读'}>{c.unread > 99 ? '99+' : c.unread}</b>
                      )}
                    </div>
                  </a>
                ))}
              </nav>
              {!list.length && !error && (
                <div className="dm-list-empty">
                  {loading
                    ? '正在加载…'
                    : filter
                      ? '没有匹配的会话'
                      : view === 'requests'
                        ? '暂无消息请求'
                        : view === 'unread'
                          ? '暂无未读会话'
                          : '还没有会话，试着从帖子或用户主页发起交流。'}
                </div>
              )}
              {summary.next && (
                <button className="dm-load-more" disabled={loading} onClick={() => void more()}>
                  加载更多会话
                </button>
              )}
            </>
          )}
        </aside>
        {peer ? (
          <Chat key={peer} peer={peer} postId={params.get('post') || undefined} />
        ) : (
          <div className="dm-welcome">
            <Icon name="message-circle" />
            <h2>从一条消息开始</h2>
            <p>选择已有会话，或从感兴趣的帖子联系对方。</p>
            <button className="btn-primary" onClick={() => setFind(true)}>
              发起私信
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
type Pending = {
  id: string;
  text: string;
  draft: string;
  postId?: string | undefined;
  createdAt: string;
  state: 'sending' | 'failed';
  error?: string;
};
function Chat({ peer, postId }: { peer: string; postId?: string | undefined }) {
  const { data, toast } = useCommunity();
  const { refresh: refreshList, setView } = useMessages();
  const key = 'umeet-message-' + data!.actor!.userId + '-' + peer;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  });
  const textRef = useRef(text);
  const [page, setPage] = useState<MessagePage | null>(() => messageResources.peek<MessagePage>('/' + peer) ?? null);
  const current = useRef<MessagePage | null>(page);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending[]>(() => {
    try {
      const items: Pending[] = JSON.parse(localStorage.getItem(key + '-outbox') || '[]');
      return items
        .filter(
          (item) =>
            typeof item.id === 'string' &&
            typeof item.text === 'string' &&
            typeof item.draft === 'string',
        )
        .map((item) => ({ ...item, state: 'failed', error: '发送状态待确认，可以重试' }));
    } catch {
      return [];
    }
  });
  const pendingRef = useRef<Pending[]>(pending);
  const [busy, setBusy] = useState(false);
  const [older, setOlder] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const selection = useRef({ start: text.length, end: text.length });
  const nearBottom = useRef(true);
  const scroll = useRef<'bottom' | number | null>('bottom');
  const readBoundary = useRef('');
  const alive = useRef(true);
  const requestOrder = useRef(0);
  const actionRunning = useRef(false);
  const loadingMessages = useRef(false);
  const reference = data!.content.posts.find((post) => post.id === postId);
  function change(value: string) {
    textRef.current = value;
    setText(value);
    try {
      localStorage.setItem(key, value);
    } catch {}
  }
  function updatePending(items: Pending[]) {
    pendingRef.current = items;
    try {
      localStorage.setItem(key + '-outbox', JSON.stringify(items));
    } catch {}
    if (alive.current) setPending(items);
  }
  function apply(value: MessagePage) {
    messageResources.seed('/' + peer, value);
    current.current = value;
    setPage(value);
  }
  async function markRead(value: MessagePage) {
    const last = value.messages.at(-1);
    if (
      !last ||
      !value.conversation.unread ||
      document.visibilityState !== 'visible' ||
      !nearBottom.current ||
      readBoundary.current === last.id
    )
      return;
    readBoundary.current = last.id;
    try {
      await messageApi('/' + peer + '/action', { action: 'read', messageId: last.id });
      if (alive.current) await refreshList();
    } catch {
      readBoundary.current = '';
    }
  }
  async function load() {
    if (actionRunning.current || loadingMessages.current) return;
    loadingMessages.current = true;
    const order = ++requestOrder.current;
    try {
      const latest = current.current?.messages.at(-1)?.id;
      let result = await messageApi<MessagePage>('/' + peer + (latest ? '?after=' + latest : ''));
      while (latest && result.hasMore && alive.current && order === requestOrder.current) {
        const next = await messageApi<MessagePage>(
          '/' + peer + '?after=' + result.messages.at(-1)!.id,
        );
        result = { ...next, messages: [...result.messages, ...next.messages] };
      }
      if (!alive.current || order !== requestOrder.current) return;
      const previous = current.current;
      const changed = result.messages.some(
        (m) => !previous?.messages.some((old) => old.id === m.id),
      );
      const messages = new Map((previous?.messages || []).map((m) => [m.id, m]));
      if (result.conversation.deleted)
        for (const [id, message] of messages)
          if (message.incoming)
            messages.set(id, { ...message, text: '此消息由已注销用户发送', postId: null });
      for (const message of result.messages) messages.set(message.id, message);
      const next = {
        ...result,
        messages: [...messages.values()].sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        ),
        hasMore: current.current ? current.current.hasMore : result.hasMore,
      };
      if (changed) {
        if (nearBottom.current) scroll.current = 'bottom';
        else setNewMessages(true);
      }
      apply(next);
      setError('');
      for (const item of pendingRef.current)
        if (messages.has(item.id) && textRef.current === item.draft) change('');
      updatePending(pendingRef.current.filter((item) => !messages.has(item.id)));
      void markRead(next);
    } catch (failure) {
      if (alive.current && order === requestOrder.current) setError((failure as Error).message);
    } finally {
      loadingMessages.current = false;
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    const update = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = setInterval(update, 3000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      alive.current = false;
      requestOrder.current++;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, [peer]);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    if (scroll.current === 'bottom') {
      el.scrollTop = el.scrollHeight;
      nearBottom.current = true;
      setNewMessages(false);
    } else if (typeof scroll.current === 'number') el.scrollTop = el.scrollHeight - scroll.current;
    scroll.current = null;
  }, [page, pending]);
  async function history() {
    if (!page?.messages[0] || older) return;
    setOlder(true);
    const previousHeight = viewport.current!.scrollHeight - viewport.current!.scrollTop;
    try {
      const result = await messageApi<MessagePage>('/' + peer + '?before=' + page.messages[0].id);
      if (!alive.current) return;
      const messages = new Map(
        [...result.messages, ...(current.current?.messages || [])].map((m) => [m.id, m]),
      );
      scroll.current = previousHeight;
      apply({ ...current.current!, hasMore: result.hasMore, messages: [...messages.values()] });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      if (alive.current) setOlder(false);
    }
  }
  async function action(body: unknown) {
    if (actionRunning.current) return false;
    actionRunning.current = true;
    setBusy(true);
    requestOrder.current++;
    try {
      const conversation = await messageApi<Conversation>('/' + peer + '/action', body);
      if (alive.current && current.current) apply({ ...current.current, conversation });
      await refreshList();
      return true;
    } catch (failure) {
      toast((failure as Error).message);
      return false;
    } finally {
      actionRunning.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function send(item: Pending) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true);
    requestOrder.current++;
    updatePending([
      ...pendingRef.current.filter((p) => p.id !== item.id),
      { ...item, state: 'sending' },
    ]);
    scroll.current = 'bottom';
    try {
      await messageApi<Message>('/' + peer + '/send', {
        id: item.id,
        text: item.text,
        ...(item.postId ? { postId: item.postId } : {}),
      });
      updatePending(pendingRef.current.filter((p) => p.id !== item.id));
      // A completed send can outlive the mounted conversation. Keep the saved draft consistent.
      try {
        if (localStorage.getItem(key) === item.draft) localStorage.removeItem(key);
      } catch {}
      if (!alive.current) return;
      // Fetch from the preceding cursor so simultaneous incoming messages are included.
      if (textRef.current === item.draft) change('');
      if (item.postId && postId === item.postId) navigateCommunity(inboxHref(peer));
      setView('messages');
      await refreshList();
    } catch (failure) {
      updatePending(
        pendingRef.current.map((p) =>
          p.id === item.id ? { ...p, state: 'failed', error: (failure as Error).message } : p,
        ),
      );
    } finally {
      actionRunning.current = false;
      if (alive.current) {
        setBusy(false);
        void load();
      }
    }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || pendingRef.current.length || (!text.trim() && !reference)) return;
    const item: Pending = {
      id: 'm' + crypto.randomUUID(),
      text: text.trim(),
      draft: text,
      postId: reference?.id,
      createdAt: new Date().toISOString(),
      state: 'sending',
    };
    void send(item);
  }
  const person = page?.conversation;
  const canSend =
    person &&
    !person.blocked &&
    !person.unavailable &&
    (person.status === 'accepted' || person.status === 'new');
  return (
    <section className="dm-chat" aria-label="聊天">
      <header className="dm-chat-heading">
        <a className="dm-back" href="#/inbox" aria-label="返回会话列表">
          ‹
        </a>
        {person && <Avatar person={person} />}
        <div className="dm-chat-person">
          <a href={'#/users/' + peer}>{person?.name || '正在加载…'}</a>
          <small>
            {person?.blocked
              ? '已拉黑此用户'
              : person?.muted
                ? '消息免打扰'
                : person?.status === 'pending'
                  ? '消息请求'
                  : '一对一私信'}
          </small>
        </div>
        {person && (
          <details className="dm-actions">
            <summary aria-label="会话操作">⋯</summary>
            <div>
              <a href={'#/users/' + peer}>查看主页</a>
              <button
                disabled={busy}
                onClick={() => void action({ action: 'mute', value: !person.muted })}
              >
                {person.muted ? '取消免打扰' : '消息免打扰'}
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  if (await action({ action: 'hide' })) navigateCommunity('#/inbox');
                }}
              >
                隐藏会话
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (person.blocked || confirm('拉黑后，双方将无法继续发送私信。'))
                    void action({ action: 'block', value: !person.blocked });
                }}
              >
                {person.blocked ? '解除拉黑' : '拉黑用户'}
              </button>
            </div>
          </details>
        )}
      </header>
      {error && (
        <div className="dm-error" role="alert">
          {error}
          <button onClick={() => void load()}>重试</button>
        </div>
      )}
      <div
        className="dm-message-viewport"
        ref={viewport}
        onScroll={() => {
          const el = viewport.current!;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          if (nearBottom.current) {
            setNewMessages(false);
            if (current.current) void markRead(current.current);
          }
        }}
      >
        {page?.hasMore && (
          <button className="dm-load-more" disabled={older} onClick={() => void history()}>
            {older ? '加载中…' : '查看更早消息'}
          </button>
        )}
        {!page && !error && <p className="dm-empty-chat">正在加载消息…</p>}
        {page && !page.messages.length && (
          <div className="dm-empty-chat">
            <h3>和 {person?.name} 开始交流</h3>
            <p>介绍一下来意，对方接受后即可继续聊天。</p>
          </div>
        )}
        <ol className="dm-messages">
          {page?.messages.map((message, index) => {
            const previous = page.messages[index - 1];
            const date = new Date(message.createdAt).toLocaleDateString('zh-CN');
            const showDate =
              !previous || new Date(previous.createdAt).toLocaleDateString('zh-CN') !== date;
            const post = data!.content.posts.find((p) => p.id === message.postId);
            return (
              <li
                key={message.id}
                className={'dm-message ' + (message.incoming ? 'incoming' : 'outgoing')}
              >
                {showDate && <div className="dm-date">{date}</div>}
                <div className="dm-message-line">
                  {message.incoming && person && <Avatar person={person} />}
                  <div className="dm-bubble">
                    {message.text && <p>{message.text}</p>}
                    {message.postId &&
                      (post ? (
                        <a className="dm-post-card" href={postHref(post)}>
                          <span>来自社区的帖子</span>
                          <strong>{post.title}</strong>
                        </a>
                      ) : (
                        <p className="dm-post-unavailable">引用的帖子已不可用</p>
                      ))}
                  </div>
                </div>
                <div className="dm-message-meta">
                  <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
                  {!message.incoming && <span>已发送</span>}
                  {message.incoming && <ReportButton target={'message:' + message.id} />}
                </div>
              </li>
            );
          })}
          {pending.map((item) => (
            <li key={item.id} className="dm-message outgoing">
              <div className="dm-message-line">
                <div className="dm-bubble">
                  <p>{item.text || '[帖子]'}</p>
                </div>
              </div>
              <div className="dm-message-meta">
                {item.state === 'sending' ? (
                  '发送中…'
                ) : (
                  <>
                    <span role="alert">{item.error}</span>
                    <button onClick={() => void send(item)} disabled={busy}>
                      重试发送
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {newMessages && (
        <button
          className="dm-new-messages"
          onClick={() => {
            viewport.current!.scrollTop = viewport.current!.scrollHeight;
            nearBottom.current = true;
            setNewMessages(false);
            if (current.current) void markRead(current.current);
          }}
        >
          有新消息 ↓
        </button>
      )}
      {person?.incomingRequest && !person.blocked ? (
        <div className="dm-request-panel">
          <p>
            <strong>{person.name}</strong> 想与你交流，接受后可以回复。
          </p>
          <div>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => void action({ action: 'accept' })}
            >
              接受请求
            </button>
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={async () => {
                if (await action({ action: 'ignore' })) navigateCommunity('#/inbox');
              }}
            >
              忽略
            </button>
            <button
              className="link-btn"
              disabled={busy}
              onClick={() => void action({ action: 'block', value: true })}
            >
              拉黑
            </button>
          </div>
        </div>
      ) : person && !canSend ? (
        <div className="dm-request-panel">
          <p>
            {person.blocked
              ? '你已拉黑此用户，可在会话操作中解除。'
              : person.unavailable
                ? '暂时无法向此用户发送私信。'
                : person.status === 'ignored'
                  ? '此会话暂不可继续发送。'
                  : '请求已发送，等待对方接受后继续交流。'}
          </p>
        </div>
      ) : (
        person && (
          <form className="dm-compose" id="message-form" onSubmit={submit}>
            {reference && (
              <div className="dm-reference">
                <span>关于帖子</span>
                <a href={postHref(reference)}>{reference.title}</a>
                <a href={inboxHref(peer)} aria-label="移除帖子引用">
                  ×
                </a>
              </div>
            )}
            <textarea
              ref={input}
              id="message-text"
              aria-label="消息内容"
              value={text}
              maxLength={2000}
              placeholder={person.status === 'new' ? '介绍一下你的来意…' : '写一条消息…'}
              onChange={(e) => {
                selection.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
                change(e.target.value);
              }}
              onSelect={(e) => {
                if (document.activeElement === e.currentTarget)
                  selection.current = {
                    start: e.currentTarget.selectionStart,
                    end: e.currentTarget.selectionEnd,
                  };
              }}
              onBlur={(e) => {
                selection.current = {
                  start: e.currentTarget.selectionStart,
                  end: e.currentTarget.selectionEnd,
                };
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="dm-compose-tools">
              <button
                type="button"
                className="icon-btn"
                ref={emojiButton}
                aria-label="添加表情"
                aria-expanded={emoji}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEmoji(!emoji)}
              >
                <Icon name="smile" />
              </button>
              <small>Enter 发送，Shift + Enter 换行</small>
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || pending.length > 0 || (!text.trim() && !reference)}
              >
                发送
              </button>
            </div>
            <ToolbarPopover
              id="dm-emoji"
              label="选择表情"
              open={emoji}
              anchor={emojiButton}
              onClose={() => setEmoji(false)}
            >
              <div className="composer-emoji-grid">
                {[
                  '😀',
                  '😂',
                  '🤔',
                  '🥹',
                  '😊',
                  '👍',
                  '🙏',
                  '❤️',
                  '🎉',
                  '🤝',
                  '✨',
                  '😅',
                  '😭',
                  '😎',
                  '📚',
                  '☕',
                ].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-label={'插入表情 ' + value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const { start, end } = selection.current;
                      const result = text.slice(0, start) + value + text.slice(end);
                      if (result.length > 2000) return;
                      change(result);
                      setEmoji(false);
                      requestAnimationFrame(() => {
                        input.current?.focus();
                        input.current?.setSelectionRange(
                          start + value.length,
                          start + value.length,
                        );
                      });
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </ToolbarPopover>
          </form>
        )
      )}
    </section>
  );
}
