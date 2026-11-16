import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Bound page-data workers for local 16 GB workstations and small CI runners.
  experimental: { cpus: 2 },
  async redirects(){return [
    {source:'/demo/index.html',destination:'/',permanent:false},
    {source:'/communities',destination:'/community/discover',permanent:false},
    {source:'/me',destination:'/community/me',permanent:false},
    {source:'/me/security',destination:'/community/settings',permanent:false},
    {source:'/posts/:id',destination:'/community/posts/:id',permanent:false},
    {source:'/c/:slug',destination:'/community/c/:slug',permanent:false},
    {source:'/c/:slug/wiki',destination:'/community/c/:slug/wiki',permanent:false},
    {source:'/wiki',destination:'/knowledge',permanent:false},
    {source:'/wiki/:id',destination:'/community/wiki/:id',permanent:false},
    {source:'/wiki/:id/edit',destination:'/community/wiki/:id',permanent:false},
    {source:'/wiki/:id/history',destination:'/community/wiki/:id',permanent:false},
    {source:'/c/:slug/wiki/new',destination:'/community/c/:slug/wiki',permanent:false},
    {source:'/search',destination:'/community/search',permanent:false},

  ];},
  turbopack: { root },
  outputFileTracingRoot: root,
};
export default config;
