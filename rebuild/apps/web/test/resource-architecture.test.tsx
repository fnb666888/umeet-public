// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ResourceDomain, invalidateResources } from '../src/lib/resources';
import { useResource } from '../src/lib/use-resource';
import { setAccountState } from '../src/lib/browser-session';
import { PrefetchScheduler } from '../src/lib/prefetch-scheduler';
let version=4000;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);setAccountState({deviceId:'architecture',version:++version,currentUserId:'alice',accounts:[]});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('shares equivalent query keys and consumer aborts without cancelling another reader',async()=>{
 const domain=new ResourceDomain('test-shared');let resolve!:(value:number)=>void;
 const load=vi.fn(()=>new Promise<number>(r=>{resolve=r;}));const abort=new AbortController();
 const first=domain.read('items?b=2&a=1',load,abort.signal);const failed=expect(first).rejects.toThrow('Aborted');
 const second=domain.read('items?a=1&b=2',load);abort.abort();await failed;resolve(7);
 expect(await second).toBe(7);expect(load).toHaveBeenCalledTimes(1);expect(domain.peek('items?b=2&a=1')).toBe(7);
});
it('does not refill invalidated data from an earlier read',async()=>{
 const domain=new ResourceDomain('test-generation');let resolve!:(value:string)=>void;
 const read=domain.read('page',()=>new Promise<string>(r=>{resolve=r;}));domain.invalidate();resolve('old');await read;
 expect(domain.peek('page')).toBeUndefined();
});
it('does not evict a new account resource when the previous account request fails late',async()=>{
 const domain=new ResourceDomain('test-old-authorization');let reject!:(error:Error)=>void;
 const old=domain.read('page',()=>new Promise<string>((_,r)=>{reject=r;}));
 const rejected=expect(old).rejects.toThrow('expired');
 setAccountState({deviceId:'architecture',version:++version,currentUserId:'bob',accounts:[]});
 domain.seed('page','new account');reject(Object.assign(new Error('expired'),{status:401}));await rejected;
 expect(domain.peek('page')).toBe('new account');
});
it('updates mounted readers after cross-module mutation, retains stale content on network failure, clears on identity change',async()=>{
 const domain=new ResourceDomain('test-mounted');let count=0,fail=false;
 const load=async()=>{if(fail)throw new Error('offline');return String(++count);};
 await domain.read('page',load);const host=document.createElement('div'),root=createRoot(host);
 function Page(){const r=useResource(domain,'page',()=>domain.read('page',load));return <div>{r.loading?'loading':r.data}<span>{r.error}</span></div>;}
 try{
  await act(async()=>root.render(<Page/>));expect(host.textContent).toBe('1');
  await act(async()=>invalidateResources(['test-mounted']));expect(host.textContent).toBe('2');
  fail=true;await act(async()=>invalidateResources(['test-mounted']));expect(host.textContent).toContain('2offline');
  await act(async()=>setAccountState({deviceId:'architecture',version:++version,currentUserId:'bob',accounts:[]}));expect(host.textContent).not.toContain('2');
 }finally{await act(async()=>root.unmount());}
});
it('limits speculative concurrency and promotes user intent ahead of queued background tasks',async()=>{
 const scheduler=new PrefetchScheduler(1),order:string[]=[];let finish!:()=>void;
 const first=scheduler.enqueue('first',()=>new Promise<void>(r=>{finish=r;}));
 const background=scheduler.enqueue('background',async()=>{order.push('background');});
 const intended=scheduler.enqueue('intent',async()=>{order.push('intent');},1);
 await Promise.resolve();expect(order).toEqual([]);finish();await Promise.all([first,background,intended]);expect(order).toEqual(['intent','background']);
});
it('restarts mounted reads when browser identity finishes initializing',async()=>{
 const domain=new ResourceDomain('test-identity-ready'),load=vi.fn(async()=> 'account ready');
 const host=document.createElement('div'),root=createRoot(host);
 function Page(){const r=useResource(domain,'account',()=>domain.read('account',load));return <div>{r.data ?? 'loading'}</div>;}
 try {
  await act(async()=>root.render(<Page/>));expect(host.textContent).toBe('account ready');
  await act(async()=>setAccountState({deviceId:'architecture',version:++version,currentUserId:'bob',accounts:[]}));
  expect(load).toHaveBeenCalledTimes(2);expect(host.textContent).toBe('account ready');
 } finally { await act(async()=>root.unmount()); }
});
