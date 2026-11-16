// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({useRouter: () => ({replace: vi.fn()})}));
import { AdminWorkspace } from '../src/components/admin/AdminWorkspace';
import { setAccountState } from '../src/lib/browser-session';

let root: Root, host: HTMLDivElement;
let version = 0;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setAccountState({ deviceId: 'test', currentUserId: 'admin', version: ++version, accounts: [] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  history.replaceState(null, '', '/admin');
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function transport(stallOverview = false) {
  const send = vi.fn(async (url: string) => {
    if (url.includes('/overview') && stallOverview) return new Promise<Response>(() => {});
    const value = url.includes('/bootstrap?') ? { access: { admin: true, owner: true, boards: [] }, list: { items: [], total: 0, page: 1, pageSize: 20 } }
      : url.endsWith('/access') ? { admin: true, owner: true, boards: [] }
      : url.endsWith('/boards') ? []
      : url.includes('/items?') ? { items: [], total: 0, page: 1, pageSize: 20 }
      : url.includes('/overview') ? { pending: 0, posts: 0, replies: 0, users: 0, restricted: 0, wiki: 0 }
      : { nickname: 'Admin', userId: 'admin' };
    return new Response(JSON.stringify(value));
  });
  vi.stubGlobal('fetch', send); return send;
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === text);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
it('keeps the server-rendered queue without fetching the list again', async () => {
  const send = transport();
  await act(async () => root.render(<AdminWorkspace initialData={{ userId: 'admin', access: {admin: true, owner: true, boards: []}, list: {items: [], total: 0, page: 1, pageSize: 25}, path: 'items?section=reports&q=&status=pending&kind=all&page=1' }} />));
  expect(host.textContent).toContain('暂无待处理举报');
  expect(host.textContent).not.toContain('正在加载管理数据');
  expect(send.mock.calls.some(([url]) => url.includes('/items?') || url.includes('/bootstrap?') || url.endsWith('/access'))).toBe(false);
});
it('shows the current list without waiting for unrelated overview statistics', async () => {
  transport(true);
  await act(async () => root.render(<AdminWorkspace />));
  expect(host.textContent).toContain('暂无待处理举报');
  expect(host.textContent).not.toContain('正在加载管理数据');
});
it('reuses a visited list and does not reload overview on every menu switch', async () => {
  const send = transport();
  await act(async () => root.render(<AdminWorkspace />));
  await click('用户管理'); await click('内容管理');
  expect(send.mock.calls.filter(([url]) => url.includes('/overview'))).toHaveLength(1);
    expect(send.mock.calls.filter(([url]) => url.includes('/bootstrap?'))).toHaveLength(1);
  expect(send.mock.calls.filter(([url]) => url.includes('items?section=users'))).toHaveLength(1);
  await act(async () => (host.querySelector('[aria-label="刷新数据"]') as HTMLButtonElement).click());
  expect(send.mock.calls.filter(([url]) => url.includes('items?section=reports'))).toHaveLength(1);
});
it('restores a visited workspace while permission and list revalidation are pending', async () => {
  const send = transport();
  await act(async () => root.render(<AdminWorkspace />));
  await act(async () => root.render(null));
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 31000);
  let finishAccess!: (response: Response) => void;
  send.mockImplementation(async url => url.endsWith('/access')
    ? new Promise<Response>(resolve => { finishAccess = resolve; })
    : new Promise<Response>(() => {}));
  await act(async () => root.render(<AdminWorkspace />));
  expect(host.textContent).toContain('暂无待处理举报');
  expect(host.textContent).not.toContain('正在加载管理数据');
  await act(async () => finishAccess(new Response('{}', { status: 401 })));
  expect(host.textContent).not.toContain('暂无待处理举报');
});
