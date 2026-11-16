'use client';
import { AccountReadCache } from './account-read-cache';
import { abortableRead } from './abortable-read';
import { accountState, subscribeAccounts } from './browser-session';

export type ResourceEvent = { type: 'invalidate' | 'evict' | 'update'; key?: string };
const domains = new Set<ResourceDomain>();
/** Query order and empty ? do not create different resources. */
export function resourceKey(path: string) {
  const [base, query] = path.split('?');
  const params = new URLSearchParams(query); params.sort();
  return base + (params.size ? '?' + params : '');
}
export function invalidateResources(names?: readonly string[], notify = true) {
  for (const domain of domains) if (!names || names.includes(domain.name)) domain.invalidate(notify);
}
export class ResourceDomain {
  private cache: AccountReadCache<unknown>;
  private pending = new Map<string, Promise<unknown>>();
  private listeners = new Set<(event: ResourceEvent) => void>();
  constructor(readonly name: string, ttl = 30000) {
    this.cache = new AccountReadCache(ttl);
    domains.add(this);
    let identity = this.identity();
    subscribeAccounts(() => {
      const next = this.identity();
      if (next !== identity) {
        identity = next;
        this.evict();
        // Mounted readers must start again in the new identity scope, including
        // when the first response preceded browser-session initialization.
        this.emit({type:'invalidate'});
      }
    });
  }
  private identity() {
    const s = accountState(); return s ? JSON.stringify([s.deviceId, s.version, s.currentUserId]) : '';
  }
  subscribe = (listener: (event: ResourceEvent) => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private emit(event: ResourceEvent) { for (const listener of this.listeners) listener(event); }
  peek<T>(path: string) { return this.cache.peek(resourceKey(path))?.value as T | undefined; }
  seed<T>(path: string, value: T) { const key = resourceKey(path); this.cache.set(key, value, this.cache.token()); this.emit({type:'update', key}); }
  forget(path: string) { this.cache.forget(resourceKey(path)); }
  invalidate(notify = true) { this.cache.clear(); if (notify) this.emit({type:'invalidate'}); }
  evict(path?: string) {
    const key = path === undefined ? undefined : resourceKey(path);
    if (key === undefined) this.cache.clear(); else this.cache.forget(key);
    this.emit({type:'evict', key});
  }
  async read<T>(path: string, load: () => Promise<T>, signal?: AbortSignal, cache = true): Promise<T> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const key = resourceKey(path), cached = cache ? this.cache.get(key) : undefined;
    if (cached) return cached.value as T;
    const token = this.cache.token(), pendingKey = token + ':' + key;
    let job = this.pending.get(pendingKey);
    if (!job) {
      job = load().then(value => {
        if (cache) this.cache.set(key, value, token);
        if (token === this.cache.token()) this.emit({type:'update', key});
        return value;
      }).catch(error => {
        if (token === this.cache.token()) {
          if ([401, 403].includes(error?.status)) this.evict();
          else if (error?.status === 404) this.evict(key);
        }
        throw error;
      }).finally(() => this.pending.delete(pendingKey));
      this.pending.set(pendingKey, job);
    }
    return abortableRead(job as Promise<T>, signal);
  }
}
