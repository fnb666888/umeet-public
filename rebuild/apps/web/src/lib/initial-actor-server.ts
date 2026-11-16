import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { apiUrl } from './api';
import type { InitialActor } from './initial-actor';
// React cache deduplicates only within this server render, never across users.
export const initialActor = cache(async (): Promise<InitialActor> => {
  const requestHeaders = await headers();
  if (requestHeaders.get('rsc') === '1' && requestHeaders.has('next-router-state-tree')) return null;
  const store = await cookies();
  const token = store.get('umeet_session')?.value;
  if (!token) return null;
  const key = store.get('umeet_browser')?.value;
  return fetch(apiUrl('/auth/me'), {
    headers: { Authorization: 'Bearer ' + token, ...(key ? { 'X-Browser-Key': key } : {}) },
    cache: 'no-store', signal: AbortSignal.timeout(1800),
  }).then(async response => response.ok ? await response.json() as InitialActor : null).catch(() => null);
});
