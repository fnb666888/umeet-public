// @vitest-environment jsdom
import React, { act } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=> '/',useSearchParams:()=>new URLSearchParams(),useRouter:()=>({replace(){}})}));
import { setAccountState } from '../src/lib/browser-session';
import { interestApi, cachedInterest, useInterest } from '../src/components/interest/api';
import { adminRequest } from '../src/components/admin/admin-api';
import { SiteSettings } from '../src/components/admin/SiteSettings';
import { PermissionGroups } from '../src/components/admin/PermissionGroups';
import { InitialActorContext } from '../src/lib/initial-actor';
import { CommunityProvider, useCommunity } from '../src/components/community/store';
import { AccountSessionContext } from '../src/lib/account-session-context';
let version = 1000;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setAccountState({deviceId: 'remaining', version: ++version, currentUserId: 'alice', accounts: []});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('shows verified member identity in server HTML before browser session requests', () => {
  const actor = {userId: 'alice', kind: 'member', nickname: '首屏账号'};
  function Identity() { return <span>{useCommunity().data?.actor?.nickname}</span>; }
  const html = renderToString(<InitialActorContext.Provider value={actor}><AccountSessionContext.Provider value={false}><CommunityProvider initialData={{bootstrap: true, actor: null} as never}><Identity /></CommunityProvider></AccountSessionContext.Provider></InitialActorContext.Provider>);
  expect(html).toContain('首屏账号');
});
it('keeps prefetched interest content on first paint and during slow stale refresh', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"title":"资讯已就绪"}')));
  await interestApi('news?');
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 31000);
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  function View() { const r = useInterest<{title: string}>('news?'); return <span>{r.loading ? '正在加载' : r.data?.title}</span>; }
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<View />));
    expect(host.textContent).toBe('资讯已就绪');
    await act(async () => finish(new Response('{"title":"最新资讯"}')));
    expect(host.textContent).toBe('最新资讯');
  } finally { await act(async () => root.unmount()); }
});
it('invalidates interest data after writes and identity changes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  await interestApi('admin'); await interestApi('admin/source', {});
  expect(cachedInterest('admin')).toBeUndefined();
  await interestApi('admin');
  setAccountState({deviceId:'remaining', version:++version, currentUserId:'bob', accounts:[]});
  expect(cachedInterest('admin')).toBeUndefined();
});
it('renders prepared settings and groups without a loading paint', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('groups') ? [] : {revision: 1, settings: {site: {title:'Prepared'}, announcements:[], boards:{}, reportReasons:[], registration:{}, notifications:{}}}))));
  await adminRequest('site-settings'); await adminRequest('groups');
  expect(renderToString(<SiteSettings revision={0} />)).toContain('Prepared');
  expect(renderToString(<SiteSettings revision={0} />)).not.toContain('正在加载');
  expect(renderToString(<PermissionGroups revision={0} />)).not.toContain('正在加载群组');
});
