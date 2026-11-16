'use client';
import { useEffect, useRef, useState } from 'react';
import { useCommunity } from './store';
/** Prefetch the next batch before the reader reaches the end of the feed. */
export function FeedContinuation(){
  const {data,loadMore,moreLoading}=useCommunity();
  const sentinel=useRef<HTMLDivElement>(null);
  const [failed,setFailed]=useState(false);
  const next=data?.page?.kind==='feed'?data.page.next:null;
  useEffect(()=>{setFailed(false);},[data?.resourcePath,next]);
  const load=useRef(loadMore);load.current=loadMore;
  useEffect(()=>{
    if(!next||failed||moreLoading||!sentinel.current||typeof IntersectionObserver==='undefined')return;
    let requested=false;
    const observer=new IntersectionObserver(entries=>{
      if(requested||!entries.some(entry=>entry.isIntersecting))return;
      requested=true;observer.disconnect();
      void load.current().catch(()=>setFailed(true));
    },{rootMargin:'700px 0px'});
    observer.observe(sentinel.current);
    return ()=>observer.disconnect();
  },[next,failed,moreLoading]);
  if(!next)return null;
  return <div ref={sentinel} className="feed-end" data-feed-continuation="true" aria-live="polite">
    {failed?<button className="link-btn" onClick={()=>{setFailed(false);void load.current().catch(()=>setFailed(true));}}>加载失败，点击重试</button>
      :moreLoading?'正在读取更多话题…':'继续向下浏览'}
  </div>;
}
