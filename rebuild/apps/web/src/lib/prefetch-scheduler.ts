'use client';
import { accountState, subscribeAccounts } from './browser-session';
type Task = { key: string; run: () => Promise<unknown>; resolve: () => void; priority: number };
/** Two speculative requests at a time. Foreground reads never join this queue. */
export class PrefetchScheduler {
  private queue: Task[] = [];
  private active = 0;
  private jobs = new Map<string, Promise<void>>();
  constructor(private limit = 2) {}
  enqueue(key: string, run: () => Promise<unknown>, priority = 0) {
    const existing = this.jobs.get(key);
    if (existing) {
      const task = this.queue.find(t => t.key === key); if (task) task.priority = Math.max(priority, task.priority);
      this.queue.sort((a,b) => b.priority - a.priority); return existing;
    }
    let resolve!: () => void;
    const job = new Promise<void>(done => { resolve = done; });
    this.jobs.set(key, job); this.queue.push({key, run, resolve, priority});
    this.queue.sort((a,b) => b.priority - a.priority); this.drain(); return job;
  }
  clear() { for (const task of this.queue) { this.jobs.delete(task.key); task.resolve(); } this.queue = []; }
  private drain() {
    while (this.active < this.limit && this.queue.length) {
      const task = this.queue.shift()!; this.active++;
      void Promise.resolve().then(task.run).catch(() => {}).finally(() => {
        this.active--; this.jobs.delete(task.key); task.resolve(); this.drain();
      });
    }
  }
}
export const routePrefetch = new PrefetchScheduler();
let identity = '';
subscribeAccounts(() => {
  const state = accountState(), next = state ? JSON.stringify([state.deviceId,state.version,state.currentUserId]) : '';
  if (identity !== next) { identity = next; routePrefetch.clear(); }
});
