import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { apiUrl } from './api';
import type { Snapshot } from '../components/community/model';
import { communityPagePath } from './community-page-path';
export const communityBootstrap = cache(async (): Promise<Snapshot | null> => {
  const store = await cookies();
  const requestHeaders = await headers();
  // The persistent root already exists on client transitions. Rebuilding its
  // bootstrap during every speculative RSC request defeats route prefetching.
  if (requestHeaders.get('rsc') === '1' && requestHeaders.has('next-router-state-tree')) return null;
  const pathname = requestHeaders.get('x-umeet-page') || '/';
  if (pathname === '/admin' || pathname === '/moderation' || pathname.startsWith('/account/')) return null;
  const token = store.get('umeet_session')?.value, key = store.get('umeet_browser')?.value;
  const pagePath=communityPagePath(pathname,requestHeaders.get('x-umeet-query')||'');
  if(pagePath){
    return fetch(apiUrl('/demo/'+pagePath),{
      headers:{...(token?{Authorization:'Bearer '+token}:{}),...(key?{'X-Browser-Key':key}:{})},
      cache:'no-store',signal:AbortSignal.timeout(3000),
    }).then(async r=>r.ok?{...await r.json(),resourcePath:pagePath} as Snapshot:null).catch(()=>null);
  }
  const publicData = fetch(apiUrl('/demo/bootstrap'), {cache:'no-store', signal:AbortSignal.timeout(1800)})
    .then(r => r.ok ? r.json() as Promise<Snapshot> : null).catch(() => null);
  if (!token || (pathname !== '/' && !pathname.startsWith('/community/'))) return publicData;
  const member = await fetch(apiUrl('/demo?messages=omit'), {
    headers:{Authorization:'Bearer ' + token, ...(key ? {'X-Browser-Key':key} : {})},
    cache:'no-store', signal:AbortSignal.timeout(2200),
  }).then(r => r.ok ? r.json() as Promise<Snapshot> : null).catch(() => null);
  return member ?? publicData;
});
