'use client';
import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { communityHref } from '../lib/community-route';
import { prepareRoute } from '../lib/route-resources';
export function SiteLink(props: Omit<ComponentProps<typeof NextLink>, 'onNavigate'>) {
  const raw = typeof props.href === 'string' ? props.href : null;
  const href = raw?.startsWith('/#/') ? communityHref(raw.slice(1)) : raw?.startsWith('#/') ? communityHref(raw) : props.href;
  const prepare = () => { if (typeof href === 'string') prepareRoute(href); };
  return <NextLink {...props} href={href}
    onPointerEnter={event => { props.onPointerEnter?.(event); prepare(); }}
    onFocus={event => { props.onFocus?.(event); prepare(); }} />;
}
