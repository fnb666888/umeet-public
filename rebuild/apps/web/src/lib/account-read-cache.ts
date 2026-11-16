'use client';
import { accountState } from './browser-session';

/** Short-lived memory only. Identity/version changes discard every cached read. */
export class AccountReadCache<T> {
  private scope = '';
  private revision = 0;
  private entries = new Map<string, { value: T; at: number }>();
  constructor(private readonly ttl = 30000) {}
  token() {
    const state = accountState();
    const next = state ? JSON.stringify([state.deviceId, state.version, state.currentUserId]) : '';
    if (next !== this.scope || !next) {
      this.scope = next;
      this.clear();
    }
    return this.scope + ':' + this.revision;
  }
  clear() { this.entries.clear(); this.revision++; }
  forget(key: string) { this.entries.delete(key); this.revision++; }
  peek(key: string, maxAge = 300000) {
    this.token();
    const entry = this.entries.get(key);
    return entry && Date.now() - entry.at < maxAge ? entry : undefined;
  }
  get(key: string) {
    this.token();
    const entry = this.entries.get(key);
    if (entry && Date.now() - entry.at < this.ttl) return entry;
    return undefined;
  }
  set(key: string, value: T, token: string) {
    if (token !== this.token() || !this.scope) return;
    if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, at: Date.now() });
  }
}
