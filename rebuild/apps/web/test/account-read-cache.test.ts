// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { AccountReadCache } from '../src/lib/account-read-cache';
import { setAccountState } from '../src/lib/browser-session';
import { adminRequest, invalidateAdminReads } from '../src/components/admin/admin-api';
const identity = { deviceId: 'device', version: 1, currentUserId: 'alice', accounts: [] };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('never reuses private reads after changing account, browser version or device', () => {
  const cache = new AccountReadCache<string>();
  for (const next of [
    { ...identity, currentUserId: 'bob' },
    { ...identity, version: 2 },
    { ...identity, deviceId: 'other-device' },
  ]) {
    setAccountState(identity);
    const token = cache.token(); cache.set('users', 'alice-private', token);
    expect(cache.get('users')?.value).toBe('alice-private');
    setAccountState(next);
    expect(cache.get('users')).toBeUndefined();
    cache.set('users', 'late-alice-response', token);
    expect(cache.get('users')).toBeUndefined();
  }
});
it('expires reads and prevents an invalidated in-flight read from repopulating the cache', () => {
  setAccountState(identity);
  const cache = new AccountReadCache<string>();
  const token = cache.token(); cache.set('reports', 'before-action', token);
  const time = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(time + 31000);
  expect(cache.get('reports')).toBeUndefined();
  cache.clear(); cache.set('reports', 'late-before-action', token);
  expect(cache.get('reports')).toBeUndefined();
});
it('invalidates cached admin lists after a mutation or explicit refresh', async () => {
  setAccountState(identity);
  const send = vi.fn(async () => new Response(JSON.stringify({ items: [] })));
  vi.stubGlobal('fetch', send);
  await adminRequest('items?section=reports');
  await adminRequest('items?section=reports');
  expect(send).toHaveBeenCalledTimes(1);
  await adminRequest('actions', { id: 'moderation-action' });
  await adminRequest('items?section=reports');
  expect(send).toHaveBeenCalledTimes(3);
  invalidateAdminReads();
  await adminRequest('items?section=reports');
  expect(send).toHaveBeenCalledTimes(4);
});
