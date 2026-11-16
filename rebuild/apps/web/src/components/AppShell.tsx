import Link from 'next/link';
import type { ReactNode } from 'react';
import { Menu, Search } from 'lucide-react';
import { AuthControls } from './AuthControls';
import { ShellNavigation } from './ShellNavigation';
import { PostComposer } from './discussions/PostComposer';

export function AppShell({ children, searchAction='/search', searchPlaceholder='搜索校园内容' }: { children: ReactNode;searchAction?:string;searchPlaceholder?:string }) {
  return <div className="demo-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/" aria-label="Umeet 首页"><span className="brand-initial">u</span>meet<span className="brand-dot">.</span></Link>
        <form className="search" action={searchAction} role="search">
          <Search /><input name="q" type="search" placeholder={searchPlaceholder} aria-label={searchAction==='/knowledge'?'搜索 Wiki 词条与指南':'搜索帖子、词条和社区'} maxLength={80} />
        </form>
        <div className="top-actions"><PostComposer /><AuthControls /></div>
      </div>
    </header>
    <div className="demo-layout">
      <aside className="sidebar"><ShellNavigation /></aside>
      <details className="mobile-menu"><summary><Menu />浏览社区</summary><ShellNavigation /></details>
      <main className="main-content">{children}</main>
    </div>
  </div>;
}
