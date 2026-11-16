// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=>location.pathname,useSearchParams:()=>new URLSearchParams(location.search),useRouter:()=>({replace(url:string){history.replaceState(null,'',url);}})}));
import { CommunityProvider, useCommunity } from '../src/components/community/store';

it('reuses the current account snapshot across rapid page switches', async () => {
  const transport = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('site-settings')
            ? { announcements: [], refreshAfterMs: null }
            : { actor: null, boards: [], ...(url.includes('/pages/')?{partial:true}:{}),content:{posts:[],comments:{},wiki:[],notifications:[]},userState:{likes:[],commentLikes:[],best:{},threads:[]},profiles:[],contacts:[] },
        ),
      ),
  );
  vi.stubGlobal('fetch', transport);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Page() {
    return <div>{useCommunity().hash}</div>;
  }
  try {
    await act(async () => {
      root.render(
        <CommunityProvider>
          <Page />
        </CommunityProvider>,
      );
    });
    await act(async () => {
      history.replaceState(null, '', '/community/discover');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(host.textContent).toBe('#/discover');
    expect(transport.mock.calls.filter(([url]) => url.includes('/pages/feed'))).toHaveLength(1);
    expect(transport.mock.calls.filter(([url]) => url.includes('demo?'))).toHaveLength(1);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31000);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(transport.mock.calls.filter(([url]) => url.includes('demo?'))).toHaveLength(2);
    // A new provider after account navigation must load its own snapshot.
    await act(async () => { root.render(null); });
    await act(async () => { root.render(<CommunityProvider><Page /></CommunityProvider>); });
    expect(transport.mock.calls.filter(([url]) => url.includes('demo?'))).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
