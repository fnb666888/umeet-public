'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { communityHref } from '../lib/community-route';
import { prepareRoute } from '../lib/route-resources';
/** Covers legacy plain anchors as well as components using SiteLink. */
export function NavigationRuntime() {
  const router = useRouter();
  useEffect(() => {
    const anchor = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    const prepare = (event: Event) => { const a = anchor(event); if (a) prepareRoute(a.href); };
    const command = (event: Event) => { router.push((event as CustomEvent<string>).detail); };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const a = anchor(event); if (!a || a.download || (a.target && a.target !== '_self')) return;
      const url = new URL(a.href); if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
      if (url.hash.startsWith('#/')) { event.preventDefault(); router.push(communityHref(url.hash)); return; }
      if (!/^(?:\/$|\/community\/|\/knowledge(?:\/|$)|\/c\/|\/admin$|\/moderation$)/.test(url.pathname)) return;
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
      event.preventDefault(); router.push(url.pathname + url.search + url.hash);
    };
    document.addEventListener('pointerover', prepare); document.addEventListener('focusin', prepare);
    document.addEventListener('click', navigate);
    window.addEventListener('umeet:navigate', command);
    return () => { window.removeEventListener('umeet:navigate', command); document.removeEventListener('pointerover', prepare); document.removeEventListener('focusin', prepare); document.removeEventListener('click', navigate); };
  }, [router]);
  return null;
}
