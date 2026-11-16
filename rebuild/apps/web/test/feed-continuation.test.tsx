// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({data:{resourcePath:'pages/feed?sort=hot',page:{kind:'feed',next:'cursor-1'}},moreLoading:false,loadMore:vi.fn()}));
vi.mock('../src/components/community/store',()=>({useCommunity:()=>state}));
import {FeedContinuation} from '../src/components/community/FeedContinuation';
it('automatically appends once near the end, retries a failed batch and stops at the last batch',async()=>{
  let intersect:(entries:{isIntersecting:boolean}[])=>void=()=>{};
  vi.stubGlobal('IntersectionObserver',class {constructor(callback:typeof intersect){intersect=callback;}observe(){}disconnect(){}});
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  state.loadMore.mockResolvedValue(undefined);
  const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
  try{
    await act(async()=>root.render(<FeedContinuation/>));
    await act(async()=>{intersect([{isIntersecting:true}]);intersect([{isIntersecting:true}]);});
    expect(state.loadMore).toHaveBeenCalledTimes(1);
    state.data.page.next='cursor-2';state.loadMore.mockRejectedValueOnce(new Error('offline'));
    await act(async()=>root.render(<FeedContinuation/>));
    await act(async()=>intersect([{isIntersecting:true}]));
    expect(host.textContent).toContain('加载失败');
    state.loadMore.mockResolvedValue(undefined);
    await act(async()=>host.querySelector('button')!.click());
    expect(state.loadMore).toHaveBeenCalledTimes(3);
    state.data.page.next='';await act(async()=>root.render(<FeedContinuation/>));
    expect(host.textContent).toBe('');
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
