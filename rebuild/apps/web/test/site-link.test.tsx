import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({default:({href,children}:any)=><a href={href}>{children}</a>}));
import { SiteLink } from '../src/components/SiteLink';
import { communityHref, communityHash } from '../src/lib/community-route';
it('canonicalizes community links without combining old and new fragments',()=>{
 expect(renderToStaticMarkup(<SiteLink href="/#/discover">Discover</SiteLink>)).toContain('href="/community/discover"');
 expect(renderToStaticMarkup(<SiteLink href="#/">Home</SiteLink>)).toContain('href="/"');
 expect(communityHref('#/posts/abc?thread=1#cm-2')).toBe('/community/posts/abc?thread=1#cm-2');
 expect(communityHash('/community/posts/abc','?thread=1','#cm-2')).toBe('#/posts/abc?thread=1#cm-2');
});
