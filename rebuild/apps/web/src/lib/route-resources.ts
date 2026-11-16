'use client';
import { routePrefetch } from './prefetch-scheduler';
import { accountState } from './browser-session';
import { communityHash } from './community-route';
import { communityPagePath } from './community-page-path';
export function prepareRoute(href: string, priority = 1) {
  if (!accountState() || typeof location === 'undefined') return;
  const url = new URL(href, location.href); if (url.origin !== location.origin) return;
  const state = accountState()!, scope = JSON.stringify([state.deviceId,state.version,state.currentUserId]);
  const queue = (key: string, run: () => Promise<unknown>) => routePrefetch.enqueue(scope + ':' + key, run, priority);
  const projection=communityPagePath(url.pathname,url.search,'hot',url.hash);
  if(projection)void queue(projection,async()=>{
    const {communityResources}=await import('../components/community/store');
    return communityResources.read(projection,async()=>{
      const response=await fetch('/api/backend/demo/'+projection,{cache:'no-store'});
      if(!response.ok)throw Object.assign(new Error('内容预读失败'),{status:response.status});
      return {...await response.json(),resourcePath:projection};
    });
  });
  if (url.pathname.includes('/knowledge')) {
    void queue(url.pathname + url.search, () => import('../components/knowledge/knowledge-client').then(m => m.prefetchKnowledgeHref(url.href)));
    return;
  }
  const hash = communityHash(url.pathname, url.search, url.hash), parts = hash.slice(2).split('?')[0].split('/');
  if (parts[0] === 'c' && ['news','forecasts'].includes(parts[1])) {
    const query = new URLSearchParams(hash.split('?')[1]); query.delete('tab');
    const path = parts[1] + '?' + query;
    void queue('interest/' + path, () => import('../components/interest/api').then(m => m.interestApi(path)));
  }
  if (parts[0] === 'news' || parts[0] === 'forecasts') {
    const path = 'items/' + (parts[0] === 'forecasts' ? 'forecast' : 'news') + '/' + parts[1];
    void queue('interest/' + path, () => import('../components/interest/api').then(m => m.interestApi(path)));
  }
  if (parts[0] === 'settings') {
    void queue('account', () => import('../components/community/account-client').then(m => m.accountRequest('/api/backend/account')));
  }
  if (parts[0] === 'settings' || url.pathname === '/account/dispositions') {
    void queue('dispositions', () => import('../components/community/disposition-client').then(m => m.dispositionRequest()));
  }
  if (['my-applications','apply-board'].includes(parts[0])) {
    for (const path of parts[0] === 'apply-board' ? ['eligibility'] : ['applications','teams/mine','eligibility','moderator-invitations'])
      void queue('governance/' + path, () => import('../components/community/governance-client').then(m => m.governanceRequest(path)));
  }
  if (parts[0] === 'inbox' && parts[1]) {
    void queue('messages/' + parts[1], () => import('../components/community/messaging').then(m => m.messageApi('/' + parts[1])));
  }
  if (url.pathname === '/admin' || url.pathname === '/moderation') {
    void queue('admin/access', () => import('../components/admin/admin-api').then(m => m.adminRequest('access')));
  }
}
