'use client';
import { SiteLink as Link } from './SiteLink';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { House, Compass, Bookmark, BookOpen, Heart, ShoppingBag, FolderOpen, MessageCircle, CalendarDays, School, User } from 'lucide-react';
import type { Snapshot } from './community/model';

export const communityIcons = { hollow: Heart, market: ShoppingBag, resources: FolderOpen, questions: MessageCircle, activities: CalendarDays, campus: School };
const subscriptionIcons = { treehole: Heart, market: ShoppingBag, resources: FolderOpen, questions: MessageCircle, buddies: CalendarDays, daily: School };

export function ShellNavigation() {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/backend/demo?messages=omit', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('订阅加载失败');
        const value: Snapshot = await response.json();
        if (!controller.signal.aborted) setSnapshot(value);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  const subscriptions = snapshot?.boards?.filter((board) => snapshot.userState.followedBoards?.includes(board.slug)) || [];
  const links = [
    ['/#/', '首页', House], ['/#/discover', '发现', Compass], ['/#/bookmarks', '收藏', Bookmark], ['/knowledge', 'Wiki', BookOpen],
  ] as const;
  function active(href: string) {
    return pathname === href || (href !== '/' && pathname?.startsWith(href + '/'));
  }
  return <nav aria-label="主导航">
    <div className="sec">社区</div>
    {links.map(([href, name, Icon]) => <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined}><Icon />{name}</Link>)}
    <div className="sec">订阅板块</div>
    {subscriptions.map(({slug, name}) => {
      const Icon = subscriptionIcons[slug as keyof typeof subscriptionIcons] || MessageCircle;
      const href = '/#/c/' + slug;
      return <Link key={slug} href={href}><Icon />{name}</Link>;
    })}
    {!subscriptions.length && <p className="sidebar-empty" role={failed ? 'status' : undefined}>{failed ? '订阅加载失败，请刷新重试' : snapshot ? '还没有订阅板块' : '正在加载订阅…'}</p>}
    <div className="sec">我的</div>
    <Link href="/#/me"><User />个人主页</Link>
  </nav>;
}
