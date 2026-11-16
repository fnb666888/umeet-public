import { randomUUID } from 'node:crypto';
import type { JobsService, JobLease } from './jobs.service.js';
export type JobHandler = (lease: JobLease, signal: AbortSignal) => Promise<void>;
export class JobsRunner {
  private readonly worker = 'api:' + randomUUID();
  private closing = false;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<string> | undefined;
  private controller: AbortController | undefined;
  private loopError: string | null = null;
  constructor(
    readonly jobs: JobsService,
    readonly handlers: ReadonlyMap<string, JobHandler>,
  ) {}
  get lastLoopError(): string | null {
    return this.loopError;
  }
  runOnce(): Promise<string> {
    if (this.closing || this.active) return Promise.resolve('idle');
    const active = this.execute().finally(() => {
      if (this.active === active) this.active = undefined;
    });
    this.active = active;
    return active;
  }
  private async execute(): Promise<string> {
    const lease = await this.jobs.claim(this.worker, new Date());
    if (!lease) return 'idle';
    if (this.closing) return 'lease-lost';
    const controller = new AbortController();
    this.controller = controller;
    let renewal: Promise<void> | undefined,
      stale = false;
    const heartbeat = setInterval(() => {
      if (renewal || controller.signal.aborted) return;
      renewal = this.jobs
        .renew(lease)
        .catch(() => {
          stale = true;
          controller.abort();
        })
        .finally(() => {
          renewal = undefined;
        });
    }, 20000);
    heartbeat.unref();
    const handler = this.handlers.get(lease.kind);
    let failed = false;
    try {
      if (handler) await handler(lease, controller.signal);
      else failed = true;
    } catch {
      failed = true;
    } finally {
      clearInterval(heartbeat);
      await renewal;
      this.controller = undefined;
    }
    if (stale || this.closing || controller.signal.aborted) return 'lease-lost';
    try {
      if (failed) {
        await this.jobs.retry(
          lease,
          handler ? 'HANDLER_FAILED' : 'HANDLER_UNAVAILABLE',
          new Date(),
        );
        return 'retry';
      }
      await this.jobs.complete(lease);
      return 'completed';
    } catch (error) {
      if (error instanceof Error && error.message === 'STALE_LEASE') return 'lease-lost';
      throw error;
    }
  }
  start(): void {
    if (this.closing || this.started) return;
    this.started = true;
    const tick = async () => {
      this.timer = undefined;
      try {
        await this.runOnce();
        this.loopError = null;
      } catch {
        this.loopError = 'JOB_LOOP_UNAVAILABLE';
      }
      if (!this.closing) {
        this.timer = setTimeout(() => {
          void tick();
        }, 1000);
        this.timer.unref();
      }
    };
    this.timer = setTimeout(() => {
      void tick();
    }, 0);
    this.timer.unref();
  }
  async close(timeoutMs = 30000): Promise<void> {
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.controller?.abort();
    if (!this.active) return;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.active.catch(() => {
          this.loopError = 'JOB_LOOP_UNAVAILABLE';
        }),
        new Promise<void>((resolve) => {
          deadline = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
    // Unfinished work is deliberately unacknowledged; its persisted lease can expire.
  }
}
