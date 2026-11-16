// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAccountState } from '../../../../packages/contracts/src/browser-accounts';

const initial: BrowserAccountState = {
  deviceId: 'device',
  version: 1,
  currentUserId: 'alice',
  accounts: [],
};
let dispose: (() => void) | undefined;
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      query: async () => ({ held: [] }),
      request: async (_name: string, callback: () => Promise<void> | void) => callback(),
    },
  });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('browser account transition safety', () => {
  it('starts business reads while the remembered account picker is still loading', async () => {
    const transport = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/context')) return new Response(JSON.stringify({state: initial}));
      if (String(url).endsWith('/accounts')) return new Promise<Response>(() => {});
      return new Response('{}');
    });
    vi.stubGlobal('fetch', transport);
    const session = await import('../src/lib/browser-session');
    dispose = session.installBrowserSession();
    void session.refreshAccounts();
    await expect(window.fetch('/api/backend/admin/community/access')).resolves.toBeInstanceOf(Response);
    expect(session.accountState()?.currentUserId).toBe('alice');
    expect(transport.mock.calls.some(([url]) => String(url).endsWith('/accounts'))).toBe(true);
  });
  it('waits for initial account version before sending early business reads', async () => {
    let respond!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/context')
      ? new Promise<Response>(resolve => { respond = resolve; }) : new Response('{}'));
    vi.stubGlobal('fetch', transport);
    const session = await import('../src/lib/browser-session');
    dispose = session.installBrowserSession();
    const business = window.fetch('/api/backend/interest/news');
    expect(transport).toHaveBeenCalledTimes(1);
    respond(new Response(JSON.stringify({state: initial})));
    await expect(business).resolves.toBeInstanceOf(Response);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(new Headers(transport.mock.calls[1]![1]?.headers).get('X-Umeet-Account')).toBe('alice');
  });
  it('binds a write to its starting identity and discards a slow response after account change', async () => {
    let respond!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    vi.stubGlobal('fetch', transport);
    const session = await import('../src/lib/browser-session');
    dispose = session.installBrowserSession();
    session.setAccountState(initial);
    const pending = window.fetch('/api/backend/messages', { method: 'POST', body: '{}' });
    const headers = new Headers(transport.mock.calls[0]![1]?.headers);
    expect(headers.get('X-Umeet-Account')).toBe('alice');
    expect(headers.get('X-Umeet-Browser-Version')).toBe('1');
    session.setAccountState({ ...initial, currentUserId: 'bob', version: 2 });
    respond(new Response('{"private":"alice"}'));
    await expect(pending).rejects.toThrow('账号状态已变化');
  });
  it('cancels on a failed draft save, keeps the current account and allows a retry', async () => {
    const session = await import('../src/lib/browser-session');
    dispose = session.installBrowserSession();
    session.setAccountState(initial);
    const failure = (event: Event) =>
      (event as CustomEvent).detail.waitUntil(Promise.reject(new Error('offline')));
    window.addEventListener('umeet:before-account-change', failure);
    await expect(session.prepareAccountChange()).rejects.toThrow('草稿尚未保存成功');
    expect(session.accountState()?.currentUserId).toBe('alice');
    window.removeEventListener('umeet:before-account-change', failure);
    await expect(session.prepareAccountChange()).resolves.toBeUndefined();
    session.cancelAccountChange();
  });
  it('does not discard ordinary unfinished input when the user cancels', async () => {
    const session = await import('../src/lib/browser-session');
    dispose = session.installBrowserSession();
    session.setAccountState(initial);
    const input = document.createElement('textarea');
    document.body.append(input);
    input.value = '尚未提交的回复';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(session.prepareAccountChange()).rejects.toThrow('输入内容已保留');
    expect(input.value).toBe('尚未提交的回复');
    expect(session.accountState()?.currentUserId).toBe('alice');
  });
  it('blocks business writes while accounts are changing and restores them after cancellation', async () => {
    const session = await import('../src/lib/browser-session');
    dispose = session.installBrowserSession();
    session.setAccountState(initial);
    await session.prepareAccountChange();
    await expect(window.fetch('/api/backend/demo/operations', { method: 'POST' })).rejects.toThrow(
      '正在切换账号',
    );
    session.cancelAccountChange();
    await expect(
      window.fetch('/api/backend/demo/operations', { method: 'POST' }),
    ).resolves.toBeInstanceOf(Response);
  });
  it('releases a pending tab lock when React development effects initialize twice', async () => {
    const held = new Set<string>();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (name: string, callback: () => Promise<void> | void) => {
          await Promise.resolve();
          held.add(name);
          try {
            await callback();
          } finally {
            held.delete(name);
          }
        },
        query: async () => ({ held: [...held].map((name) => ({ name })) }),
      },
    });
    const session = await import('../src/lib/browser-session');
    const first = session.installBrowserSession();
    first();
    dispose = session.installBrowserSession();
    session.setAccountState(initial);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(held.size).toBe(1);
    await expect(session.prepareAccountChange()).resolves.toBeUndefined();
    session.cancelAccountChange();
  });
});
