import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
const navigation = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(),useRouter:()=>({refresh:()=>undefined}),usePathname:()=>navigation.pathname}));
import {AppShell} from '../src/components/AppShell.js';
import { ApplicationShell } from '../src/components/ApplicationShell';
import { CommunityProvider } from '../src/components/community/store';
import { MessagingProvider } from '../src/components/community/messaging';
import { CommunityApplication } from '../src/components/community/Application';
describe('real web public navigation',()=>{
 it('exposes public navigation and loads account subscriptions without a login wall',()=>{
  const html=renderToStaticMarkup(<AppShell><h1>公开内容</h1></AppShell>);
  for(const label of ['订阅板块','Wiki','公开内容'])expect(html).toContain(label);
  expect(html).not.toContain('默认板块');
 });
 it('keeps the community header and navigation on Wiki index, articles, editing and board routes',()=>{
  const community=renderToStaticMarkup(<CommunityApplication />);
  // The search destination follows the page context; the visible outer shell stays shared.
  const header=(html:string)=>html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0]?.replace(/<div class="search-drop"[\s\S]*?<\/div>/, '');
  for(const pathname of ['/knowledge','/knowledge/article-id','/knowledge/article-id/edit','/c/physics/knowledge']) {
   navigation.pathname=pathname;
   const html=renderToStaticMarkup(<CommunityProvider><MessagingProvider><ApplicationShell><h1>知识正文</h1></ApplicationShell></MessagingProvider></CommunityProvider>);
   expect(header(html)).toBe(header(community));
   expect(html).toContain('知识正文');
   expect(html).toContain('href="/community/inbox"');
   expect(html).toContain('href="/community/discover"');
   expect(html).toMatch(/<a(?=[^>]*href="\/knowledge")(?=[^>]*class="on")(?=[^>]*aria-current="page")[^>]*>/);
   expect(html).not.toContain('demo-layout');
   expect(html).not.toContain('account-controls');
  }
  navigation.pathname='/';
 });
});
