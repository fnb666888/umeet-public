'use client';
import { updateBoardDirectory } from './model';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { Board, Operation, Snapshot } from './model';
import type { PublicSiteSettings } from '../../../../../packages/contracts/src/site-settings';
import { AccountReadCache } from '../../lib/account-read-cache';
import { useAccountSessionReady } from '../../lib/account-session-context';
import { useInitialActor } from '../../lib/initial-actor';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { communityHash, communityHref, isCommunityPath } from '../../lib/community-route';
import { invalidateResources } from '../../lib/resources';
import { ResourceDomain } from '../../lib/resources';
import { communityPagePath } from '../../lib/community-page-path';
const snapshots = new AccountReadCache<Snapshot>();
export const communityResources = new ResourceDomain('community-snapshot');

type CommunityStore = {
  data: Snapshot | null;
  ready: boolean;
  siteSettings: PublicSiteSettings | null;
  error: string;
  busy: boolean;
  hash: string;
  toast: (text: string) => void;
  message: string;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  moreLoading: boolean;
  requireLogin: () => boolean;
  mutate: (
    operations: Operation[] | ((snapshot: Snapshot) => Operation[]),
    success?: string | ((snapshot: Snapshot) => string),
  ) => Promise<boolean>;
  composer: Board | null;
  compose: (board?: Board) => void;
  closeComposer: () => void;
  view: 'card' | 'compact';
  setView: (view: 'card' | 'compact') => void;
  sort: string;
  setSort: (sort: string) => void;
  origin: { href: string; label: string } | null;
  toggleState: (
    key: 'bookmarks' | 'follows' | 'followedBoards' | 'tagFollows',
    id: string,
  ) => Promise<boolean>;
};
const Context = createContext<CommunityStore | null>(null);
export function useCommunity() {
  const value = useContext(Context);
  if (!value) throw new Error('Community provider required');
  return value;
}
export function CommunityProvider({ children, initialData }: { children: ReactNode; initialData?: Snapshot | null }) {
  const pathname = usePathname(), router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const sessionReady = useAccountSessionReady();
  const actor = useInitialActor();
  const [initial] = useState(() => initialData ? undefined : snapshots.peek('community'));
  const cacheToken = useRef(snapshots.token());
  const [data, setData] = useState<Snapshot | null>(() => initial?.value ?? (initialData ? { ...initialData, actor: actor ?? initialData.actor } : actor ? {
    bootstrap:true, actor, version:0, content:{posts:[],comments:{},wiki:[],notifications:[]},
    userState:{likes:[],commentLikes:[],best:{},threads:[]}, contacts:[],profiles:[],
  } : null));
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings | null>(null);
  useEffect(() => {
    if (!sessionReady) return;
    let request: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    async function refreshSettings() {
      request?.abort();
      clearTimeout(timeout);
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch('/api/backend/demo/site-settings', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('站点设置加载失败');
        const value: PublicSiteSettings = await response.json();
        if (controller.signal.aborted) return;
        setSiteSettings(value);
        if (value.refreshAfterMs !== null)
          timeout = setTimeout(refreshSettings, Math.min(value.refreshAfterMs + 100, 2147483647));
      } catch {
        if (controller.signal.aborted) return;
        setSiteSettings((current) => current && {
          ...current,
          announcements: current.announcements.filter((item) => !item.endsAt || Date.parse(item.endsAt) > Date.now()),
        });
        timeout = setTimeout(refreshSettings, 30000);
      }
    }
    void refreshSettings();
    window.addEventListener('focus', refreshSettings);
    return () => {
      window.removeEventListener('focus', refreshSettings);
      request?.abort();
      clearTimeout(timeout);
    };
  }, [sessionReady]);
  const current = useRef(data);
  const visitedPages=useRef(new Map<string,Snapshot>());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState(() => communityHash(pathname, searchParams.size ? '?' + searchParams : ''));
  const [message, setMessage] = useState('');
  const [composer, setComposer] = useState<Board | null>(null);
  const [view, setView] = useState<'card' | 'compact'>('compact');
  const [sort, setSort] = useState('hot');
  const [moreLoading,setMoreLoading]=useState(false);
  const routeAnchor=hash.includes('#',1)?hash.slice(hash.indexOf('#',1)):'';
  const projection=communityPagePath(pathname,searchKey,sort,routeAnchor);
  const projectionRef=useRef(projection);projectionRef.current=projection;
  const [origin, setOrigin] = useState<{ href: string; label: string } | null>(null);
  const lastRoute = useRef('');
  const legacyNavigation = useRef('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    const drain = (event: Event) => (event as CustomEvent<{ waitUntil: (job: Promise<unknown>) => void }>).detail.waitUntil(queue.current);
    window.addEventListener('umeet:before-account-change', drain);
    return () => window.removeEventListener('umeet:before-account-change', drain);
  }, []);
  const refreshSequence = useRef(0);
  const lastAppliedAt = useRef(initial?.at ?? (initialData && !initialData.bootstrap ? Date.now() : 0));
  const routeReadPending = useRef(false);
  const activeRead=useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(''), 2600);
  }, []);
  const apply = useCallback((snapshot: Snapshot) => {
    if (snapshot.suspended && location.pathname !== '/account/dispositions')
      location.replace('/account/dispositions');
    if (snapshot.boards) updateBoardDirectory(snapshot.boards);
    current.current = snapshot;
    if(!snapshot.partial)communityResources.seed('snapshot', snapshot);
    if(snapshot.resourcePath){
      communityResources.seed(snapshot.resourcePath,snapshot);
      visitedPages.current.set(snapshot.resourcePath,snapshot);
      if(visitedPages.current.size>12)visitedPages.current.delete(visitedPages.current.keys().next().value!);
    }
    snapshots.set('community', snapshot, cacheToken.current);
    lastAppliedAt.current = Date.now();
    setData(snapshot);
    setError('');
  }, []);
  useEffect(()=>{if(sessionReady&&current.current&&!current.current.bootstrap)apply(current.current);},[sessionReady,apply]);
  const refresh = useCallback(async (requested = projection) => {
    const sequence = ++refreshSequence.current;
    const communityShell = isCommunityPath(pathname) || pathname.startsWith('/knowledge') || /^\/c\/[^/]+\/knowledge(?:\/|$)/.test(pathname);
    if (!sessionReady || !communityShell) return;
    cacheToken.current = snapshots.token();
    await queue.current;
    try {
      const snapshot = await communityResources.read<Snapshot>(requested || 'snapshot', async () => {
        const response = await fetch('/api/backend/demo'+(requested?'/'+requested:'?messages=omit'), { cache: 'no-store' });
        if (!response.ok) throw Object.assign(new Error('内容加载失败，请刷新重试。'), {status:response.status});
        return {...await response.json(),...(requested?{resourcePath:requested}:{})};
      }, undefined, false);
      if (sequence === refreshSequence.current) apply(snapshot);
    } catch (failure) {
      if (sequence === refreshSequence.current)
        setError(failure instanceof Error ? failure.message : '网络连接失败');
    }
  }, [apply, sessionReady, pathname, projection]);
  useEffect(() => communityResources.subscribe(event => {
    if (event.type === 'invalidate') { visitedPages.current.clear(); snapshots.clear(); lastAppliedAt.current = 0; void refresh(); }
  }), [refresh]);
  useEffect(() => {
    const update = () => {
      const next = communityHash(location.pathname, location.search, location.hash);
      // Composer and shared community actions also work from native Wiki URLs.
      if (location.hash.startsWith('#/')) {
        setHash(next);
        if (legacyNavigation.current !== location.href) {
          legacyNavigation.current = location.href;
          const destination = communityHref(location.hash);
          // A legacy document entry must not become the router's cached home
          // response. In-app legacy anchors are intercepted before reaching here.
          if (location.pathname === '/') location.replace(destination);
          else router.replace(destination);
        }
        return;
      }
      legacyNavigation.current = '';
      const previous = lastRoute.current;
      if (next.startsWith('#/posts/') && previous && !previous.startsWith('#/posts/')) {
        const section = previous.split('/')[1]?.split('?')[0];
        const label =
          (
            {
              c: '板块列表',
              tag: '标签列表',
              search: '搜索结果',
              discover: '发现',
              bookmarks: '收藏',
              recommended: '收藏',
              me: '个人主页',
              users: '个人主页',
            } as Record<string, string>
          )[section] || '首页';
        setOrigin({ href: previous, label });
      }
      lastRoute.current = next;
      setHash(next);
      // Route rendering uses the current account's in-memory snapshot immediately.
      // Mutations and explicit refreshes still read fresh data; never persist it
      // across account changes (which reload the document).
      revalidate();
    };
    const revalidate = () => {
      const desired=communityPagePath(location.pathname,location.search,sort,location.hash);
      const matches=desired ? current.current?.resourcePath===desired : !current.current?.partial;
      if (
        (routeReadPending.current && activeRead.current===(desired||'snapshot')) ||
        (matches && current.current && Date.now() - lastAppliedAt.current < 30000)
      )
        return;
      const cached=communityResources.peek<Snapshot>(desired||'snapshot');
      if(!matches && cached && (desired || !cached.partial)) {++refreshSequence.current;routeReadPending.current=false;apply(cached);return;}
      routeReadPending.current = true;
      activeRead.current=desired||'snapshot';
      void refresh(desired).finally(() => {
        if(activeRead.current===(desired||'snapshot'))routeReadPending.current = false;
      });
    };
    update();
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    window.addEventListener('focus', revalidate);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
      window.removeEventListener('focus', revalidate);
      clearTimeout(timer.current);
    };
  }, [refresh, pathname, searchKey, projection, apply]);
  async function loadMore(){
    const before=current.current, next=before?.page?.next;
    if(!projection||!next||moreLoading)return;
    const sequence=refreshSequence.current;
    setMoreLoading(true);
    try{
      const response=await fetch('/api/backend/demo/'+projection+(projection.includes('?')?'&':'?')+new URLSearchParams({cursor:next}),{cache:'no-store'});
      if(!response.ok)throw new Error('更多内容加载失败，请重试');
      const part:Snapshot=await response.json();
      if(projectionRef.current!==projection||sequence!==refreshSequence.current)return;
      const latest=current.current!;
      const unique=<T extends {id:string}>(items:T[])=>[...new Map(items.map(item=>[item.id,item])).values()];
      apply({...latest,page:part.page,content:{...latest.content,
        posts:unique([...latest.content.posts,...part.content.posts]),
        comments:{...latest.content.comments,...Object.fromEntries(Object.entries(part.content.comments).map(([id,replies])=>[id,unique([...(latest.content.comments[id]||[]),...replies])]))}},
        userState:{...part.userState,likes:[...new Set([...latest.userState.likes,...part.userState.likes])],commentLikes:[...new Set([...latest.userState.commentLikes,...part.userState.commentLikes])],best:{...latest.userState.best,...part.userState.best}}});
    }catch(failure){toast(failure instanceof Error?failure.message:'加载失败，请重试');throw failure;}
    finally{setMoreLoading(false);}
  }
  function requireLogin() {
    if (!sessionReady || current.current?.bootstrap) { toast('账号信息正在加载，请稍后再操作'); return false; }
    if (current.current?.suspended) { toast('账号使用受限，请先查看管理记录或提交申诉'); return false; }
    if (current.current?.actor?.kind === 'member') return true;
    window.dispatchEvent(new CustomEvent('umeet:login', { detail: '请先使用邮箱登录' }));
    return false;
  }
  async function mutate(
    operations: Operation[] | ((snapshot: Snapshot) => Operation[]),
    success?: string | ((snapshot: Snapshot) => string),
  ) {
    if (!requireLogin()) return false;
    const work = async () => {
      setBusy(true);
      ++refreshSequence.current;
      const resolvedOperations=typeof operations==='function'?operations(current.current!):operations;
      try {
        const body = JSON.stringify({
          id: crypto.randomUUID(),
          operations: resolvedOperations,
        });
        let response: Response | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            response = await fetch('/api/backend/demo/operations?messages=omit'+(projection?'&projection=page':''), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            });
            break;
          } catch (failure) {
            if (attempt === 1) throw failure;
          }
        }
        if (!response) throw new Error('网络连接失败');
        if (!response.ok) {
          const failure: { message?: string; code?: string } = await response.json();
          throw new Error(
            failure.code === 'ACCOUNT_RESTRICTED'
              ? failure.message || '账号处于禁言状态'
              : failure.message === 'POST_LOCKED' ? '该帖已锁定回复，草稿已保留'
              : failure.message === 'BOARD_READ_ONLY' ? '此板块暂停发帖和回复，草稿已保留'
              : failure.message === 'BOARD_POST_COOLDOWN' ? '此板块有发帖间隔，请稍后再试，草稿已保留'
              : failure.message === 'FIRST_POST_ALREADY_PENDING' ? '已有首帖等待审核，草稿已保留'
              : failure.message === 'WIKI_PROTECTED' ? '该词条已受到保护，请联系社区管理人员'
              : failure.message === 'CONTENT_HIDDEN'
                ? '该内容已被管理员隐藏，暂时无法操作'
                : failure.message === 'WIKI_REVISION_CONFLICT'
                  ? '词条已有新修订，请核对最新内容后合并修改'
                  : '保存失败，请重试，输入内容已保留',
          );
        }
        let snapshot: Snapshot;
        if(projection){
          await response.json();
          const ops=JSON.parse(body).operations as Operation[];
          const reply=ops.find(op=>op.type==='reply.create');
          const postOp=ops.find(op=>'postId' in op);
          const focus=reply?.type==='reply.create'?reply.reply.id:current.current?.page?.kind==='feed'&&postOp&&'postId' in postOp?postOp.postId:null;
          const readParams=new URLSearchParams(projection.split('?')[1]);
          if(focus)readParams.set('focus',focus);
          const readPath=projection.split('?')[0]+(readParams.size?'?'+readParams:'');
          const read=await fetch('/api/backend/demo/'+readPath,{cache:'no-store'});
          if(!read.ok)throw new Error('已保存，页面更新失败，请刷新查看');
          snapshot={...await read.json(),resourcePath:projection};
          const before=current.current;
          // Interaction must not discard pages the reader has already scrolled through.
          if(before?.resourcePath===projection && !ops.some(op=>op.type==='post.create')){
            const posts=new Map(snapshot.content.posts.map(post=>[post.id,post]));
            const comments=new Map(Object.entries(snapshot.content.comments));
            snapshot={...snapshot,page:before.page,content:{...snapshot.content,
              posts:before.content.posts.map(post=>posts.get(post.id)||post),
              comments:{...before.content.comments,...Object.fromEntries([...comments].map(([id,replies])=>[id,[...new Map([...(before.content.comments[id]||[]),...replies].map(reply=>[reply.id,reply])).values()]]))}},
              userState:{...snapshot.userState,likes:[...new Set([...before.userState.likes.filter(id=>!posts.has(id)),...snapshot.userState.likes])],commentLikes:[...new Set([...before.userState.commentLikes.filter(id=>!Object.entries(snapshot.content.comments).some(([postId,replies])=>replies.some(reply=>postId+':'+reply.id===id))),...snapshot.userState.commentLikes])]}};
          }
        }else snapshot=await response.json();
        apply(snapshot);
        if (success) toast(typeof success === 'function' ? success(snapshot) : success);
        return true;
      } catch (failure) {
        toast(failure instanceof Error ? failure.message : '保存失败，请重试');
        return false;
      } finally {
        setBusy(false);
        // Revalidate other readers; this page already received its fresh projection.
        communityResources.invalidate(false);
        const fresh=current.current;
        const preserveFeeds=resolvedOperations.every(op=>['post.vote','reply.vote'].includes(op.type)||(op.type==='state.save'&&Object.keys(op.state).every(key=>['bookmarks','readNotifications'].includes(key))));
        if(preserveFeeds&&fresh){
          const updated=new Map(fresh.content.posts.map(post=>[post.id,post]));
          for(const [path,cached] of visitedPages.current){
            if(cached.page?.kind!=='feed')continue;
            const snapshot={...cached,userState:{...cached.userState,...fresh.userState,likes:[...new Set([...cached.userState.likes.filter(id=>!updated.has(id)),...fresh.userState.likes])]},content:{...cached.content,posts:cached.content.posts.map(post=>updated.has(post.id)?{...post,...updated.get(post.id),summary:true}:post)}};
            visitedPages.current.set(path,snapshot);communityResources.seed(path,snapshot);
          }
        }else visitedPages.current.clear();
        invalidateResources(['knowledge','interest','community-governance','account-dispositions','account']);
        if(current.current?.resourcePath)communityResources.seed(current.current.resourcePath,current.current);
      }
    };
    const result = queue.current.then(work, work);
    queue.current = result.then(() => undefined);
    return result;
  }
  async function toggleState(
    key: 'bookmarks' | 'follows' | 'followedBoards' | 'tagFollows',
    id: string,
  ) {
    return mutate((snapshot) => {
      const values = snapshot.userState[key] || [];
      const next = values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
      return key === 'followedBoards'
        ? [{ type: 'state.save', state: { followedBoards: next as Board[] } }]
        : [{ type: 'state.save', state: { [key]: next } }];
    });
  }
  return (
    <Context.Provider
      value={{
        data,
        ready: Boolean(data && !data.bootstrap && (projection ? data.resourcePath===projection || (data.page?.kind==='post' && projection.startsWith('pages/posts/'+data.page.postId+'?')) : !data.partial)),
        siteSettings,
        error,
        busy,
        hash: isCommunityPath(pathname) ? communityHash(pathname, searchKey ? '?' + searchKey : '', hash.startsWith(communityHash(pathname, searchKey ? '?' + searchKey : '')) && hash.includes('#', 1) ? hash.slice(hash.indexOf('#', 1)) : '') : hash,
        message,
        toast,
        refresh,
        loadMore,
        moreLoading,
        requireLogin,
        mutate,
        composer,
        compose: (board = 'questions') => {
          if (requireLogin()) setComposer(board);
        },
        closeComposer: () => setComposer(null),
        view,
        setView,
        sort,
        setSort,
        origin,
        toggleState,
      }}
    >
      {children}
    </Context.Provider>
  );
}
