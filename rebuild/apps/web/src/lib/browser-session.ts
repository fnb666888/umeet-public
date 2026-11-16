'use client';
import type { BrowserAccountState } from '../../../../packages/contracts/src/browser-accounts';

type Message = {
  type: 'prepare' | 'ack' | 'cancel' | 'commit';
  id: string;
  from: string;
  ok?: boolean;
  message?: string;
};
let state: BrowserAccountState | null = null;
let originalFetch: typeof fetch;
let channel: BroadcastChannel | null = null;
let tabId = '';
let transition = '';
let preparing = false;
function setTransition(id: string) {
  transition = id;
  window.dispatchEvent(new CustomEvent('umeet:account-transition', { detail: !!id }));
}
let accountRead: Promise<BrowserAccountState> | null = null;
let contextRead: Promise<BrowserAccountState> | null = null;
const activeWrites = new Set<Promise<unknown>>();
const dirtyInputs = new Set<HTMLElement>();
const listeners = new Set<() => void>();
const acknowledgments = new Map<string, (message: Message) => void>();
const prefix = 'umeet:account-tab:';
export const accountState = () => state;
export function subscribeAccounts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setAccountState(next: BrowserAccountState) {
  state = next;
  for (const listener of listeners) listener();
}
export async function refreshAccounts() {
  if (!accountRead)
    accountRead = (async () => {
      await refreshAccountContext();
      const response = await fetch('/api/session/accounts', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法读取账号列表，请稍后重试');
      const data = await response.json();
      if (state && (data.state.deviceId !== state.deviceId || data.state.version !== state.version || data.state.currentUserId !== state.currentUserId)) {
        // Never bind an old business tree to a newly observed identity in-place.
        navigateAfterChange();
        return data.state as BrowserAccountState;
      }
      setAccountState(data.state);
      return data.state as BrowserAccountState;
    })().finally(() => {
      accountRead = null;
    });
  return accountRead;
}
export async function refreshAccountContext() {
  if (state) return state;
  if (!contextRead) contextRead = (async () => {
    const response = await fetch('/api/session/context', { cache: 'no-store' });
    // An expired login is represented as signed-out by the full account reply,
    // preserving the existing recovery path without granting business access.
    if (!response.ok) {
      if (response.status !== 401) throw new Error('无法校验当前账号，请稍后重试');
      const fallback = await fetch('/api/session/accounts', { cache: 'no-store' });
      if (!fallback.ok) throw new Error('无法读取账号状态，请稍后重试');
      const data = await fallback.json(); setAccountState(data.state); return data.state as BrowserAccountState;
    }
    const data = await response.json();
    setAccountState(data.state);
    return data.state as BrowserAccountState;
  })().finally(() => { contextRead = null; });
  return contextRead;
}
async function preflight() {
  preparing = true;
  try {
    const waiting: Promise<unknown>[] = [];
    const event = new CustomEvent('umeet:before-account-change', {
      cancelable: true,
      detail: { waitUntil: (job: Promise<unknown>) => waiting.push(job) },
    });
    const allowed = window.dispatchEvent(event);
    const results = await Promise.allSettled(waiting);
    if (!allowed) throw new Error('已取消账号切换，请先处理未保存的内容');
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('草稿尚未保存成功，请保存后再切换账号');
    const unsaved = [...dirtyInputs].filter(
      (element) =>
        element.isConnected &&
        !element.closest(
          '#umeet-auth-dialog, .account-picker, [data-account-draft-safe], .knowledge-editor, .kb-editor, .admin-settings',
        ),
    );
    if (
      unsaved.length &&
      !window.confirm('页面中有尚未提交的输入，切换账号将离开当前页面。是否继续？')
    )
      throw new Error('已取消账号切换，输入内容已保留');
    await Promise.allSettled([...activeWrites]);
  } finally {
    preparing = false;
  }
}
function post(message: Message) {
  channel?.postMessage(message);
}
export async function prepareAccountChange() {
  if (!state) throw new Error('账号状态尚未加载，请稍后重试');
  if (transition) throw new Error('正在处理账号切换，请稍后再试');
  const id = crypto.randomUUID();
  setTransition(id);
  try {
    await preflight();
    let ids: string[];
    if (navigator.locks?.query) {
      const locks = await navigator.locks.query();
      ids = (locks.held ?? [])
        .map((lock) => lock.name ?? '')
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length));
    } else {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
      ids = keys
        .filter((key) => Date.now() - Number(localStorage.getItem(key)) < 90000)
        .map((key) => key.slice(prefix.length));
    }
    const others = new Set(ids.filter((id) => id !== tabId));
    if (others.size && !channel)
      throw new Error('此浏览器不支持同步切换，请先关闭其他 Umeet 标签页');
    if (others.size)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          acknowledgments.delete(id);
          reject(
            new Error('有标签页尚未确认草稿状态，请回到其他 Umeet 标签页处理，或关闭它后重试'),
          );
        }, 12000);
        acknowledgments.set(id, (message) => {
          if (!others.has(message.from)) return;
          if (!message.ok) {
            clearTimeout(timer);
            acknowledgments.delete(id);
            reject(new Error(message.message || '其他标签页取消了账号切换'));
            return;
          }
          others.delete(message.from);
          if (!others.size) {
            clearTimeout(timer);
            acknowledgments.delete(id);
            resolve();
          }
        });
        post({ type: 'prepare', id, from: tabId });
      });
  } catch (error) {
    cancelAccountChange();
    throw error;
  }
}
export function cancelAccountChange() {
  if (transition) post({ type: 'cancel', id: transition, from: tabId });
  setTransition('');
}
function navigateAfterChange() {
  window.dispatchEvent(new Event('umeet:session-changed'));
  try {
    sessionStorage.setItem('umeet-account-switched', '1');
  } catch {}
  location.replace(
    location.pathname.startsWith('/knowledge') || /^\/c\/[^/]+\/knowledge/.test(location.pathname)
      ? '/knowledge'
      : '/',
  );
}
export function finishAccountChange() {
  post({ type: 'commit', id: transition, from: tabId });
  navigateAfterChange();
}

export function installBrowserSession() {
  originalFetch = window.fetch.bind(window);
  tabId = crypto.randomUUID();
  let release: (() => void) | undefined;
  let disposed = false;
  let remoteLease: ReturnType<typeof setTimeout> | undefined;
  if (navigator.locks)
    void navigator.locks.request(prefix + tabId, () => {
      if (disposed) return;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
  const heartbeat = () => {
    try {
      localStorage.setItem(prefix + tabId, String(Date.now()));
    } catch {}
  };
  heartbeat();
  const timer = setInterval(heartbeat, 20000);
  const input = (event: Event) => {
    const element = event.target;
    if (
      element instanceof HTMLElement &&
      !element.closest('[role="search"], .search') &&
      !(
        element instanceof HTMLInputElement &&
        ['search', 'password', 'checkbox', 'radio', 'range', 'file'].includes(element.type)
      )
    )
      dirtyInputs.add(element);
  };
  document.addEventListener('input', input, true);
  const blockEditing = (event: Event) => {
    if (transition && !preparing) event.preventDefault();
  };
  document.addEventListener('beforeinput', blockEditing, true);
  const submit = (event: Event) => {
    if (event.target instanceof HTMLFormElement) {
      const form = event.target;
      setTimeout(() => {
        if (!form.isConnected)
          for (const element of dirtyInputs) if (!element.isConnected) dirtyInputs.delete(element);
      }, 1000);
    }
  };
  document.addEventListener('submit', submit, true);
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      location.href,
    );
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/'))
      return originalFetch(input, init);
    // Server-rendered identity can paint before browser account initialization.
    // Hold business requests until the version is bound, rather than rejecting
    // their responses when initialization completes during the request.
    if (!state && !url.pathname.startsWith('/api/session/') && !url.pathname.startsWith('/api/verification/'))
      await refreshAccountContext();
    const captured = state;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const sessionOperation =
      url.pathname === '/api/session/accounts' ||
      (write &&
        (url.pathname.startsWith('/api/session/') ||
          url.pathname.startsWith('/api/verification/')));
    if (transition && write && !preparing && !sessionOperation)
      throw new Error('正在切换账号，请稍后再操作');
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (captured) {
      if (captured.currentUserId) headers.set('X-Umeet-Account', captured.currentUserId);
      headers.set('X-Umeet-Browser-Version', String(captured.version));
    }
    const job = originalFetch(input, { ...init, headers });
    if (write) activeWrites.add(job);
    let response: Response;
    try {
      response = await job;
    } finally {
      activeWrites.delete(job);
    }
    if (
      !sessionOperation &&
      (captured?.version !== state?.version ||
        captured?.deviceId !== state?.deviceId ||
        captured?.currentUserId !== state?.currentUserId ||
        (transition && !preparing))
    )
      throw new Error('账号状态已变化，请刷新后重试');
    return response;
  };
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('umeet:browser-accounts');
    channel.onmessage = async ({ data }: MessageEvent<Message>) => {
      if (!data || data.from === tabId || typeof data.id !== 'string') return;
      if (data.type === 'ack') {
        acknowledgments.get(data.id)?.(data);
        return;
      }
      if (data.type === 'cancel') {
        if (transition === data.id) {
          clearTimeout(remoteLease);
          setTransition('');
        }
        return;
      }
      if (data.type === 'commit') {
        navigateAfterChange();
        return;
      }
      if (data.type === 'prepare') {
        if (transition && transition !== data.id) {
          post({
            type: 'ack',
            id: data.id,
            from: tabId,
            ok: false,
            message: '另一个标签页正在切换账号',
          });
          return;
        }
        setTransition(data.id);
        clearTimeout(remoteLease);
        // Recover if the initiating tab crashes before it can send cancel/commit.
        remoteLease = setTimeout(() => {
          if (transition === data.id) {
            setTransition('');
            void check();
          }
        }, 90000);
        try {
          await preflight();
          post({ type: 'ack', id: data.id, from: tabId, ok: true });
        } catch (error) {
          post({
            type: 'ack',
            id: data.id,
            from: tabId,
            ok: false,
            message: error instanceof Error ? error.message : '其他标签页未完成保存',
          });
          clearTimeout(remoteLease);
          setTransition('');
        }
      }
    };
  }
  const check = async () => {
    if (document.visibilityState !== 'visible' || transition || !state) return;
    try {
      const response = await originalFetch('/api/session/accounts', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (
        data.state.deviceId !== state.deviceId ||
        data.state.version !== state.version ||
        data.state.currentUserId !== state.currentUserId
      )
        navigateAfterChange();
    } catch {}
  };
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  const unload = () => {
    disposed = true;
    try {
      localStorage.removeItem(prefix + tabId);
    } catch {}
    release?.();
  };
  window.addEventListener('pagehide', unload);
  return () => {
    unload();
    clearInterval(timer);
    clearTimeout(remoteLease);
    channel?.close();
    channel = null;
    window.fetch = originalFetch;
    document.removeEventListener('input', input, true);
    document.removeEventListener('beforeinput', blockEditing, true);
    document.removeEventListener('submit', submit, true);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('pagehide', unload);
  };
}
