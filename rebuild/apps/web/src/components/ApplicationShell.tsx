'use client';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AppShell } from './AppShell';
import { CommunityView } from './community/Application';
import { isCommunityPath } from '../lib/community-route';
export function ApplicationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isCommunityPath(pathname)) return <CommunityView />;
  if (pathname.startsWith('/knowledge') || /^\/c\/[^/]+\/knowledge(?:\/|$)/.test(pathname)) return <CommunityView>{children}</CommunityView>;
  return pathname === '/' || pathname === '/admin' || pathname === '/moderation' || pathname === '/account/dispositions' ? <>{children}</> : <AppShell>{children}</AppShell>;
}
