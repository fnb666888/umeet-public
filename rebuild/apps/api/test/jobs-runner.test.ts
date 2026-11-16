import { afterEach, describe, it, expect, vi } from 'vitest';
import type { JobLease } from '../src/modules/jobs/jobs.service.js';
import { JobsService } from '../src/modules/jobs/jobs.service.js';
import { JobsRunner } from '../src/modules/jobs/jobs.runner.js';
import type { Database } from '../src/database/database.types.js';
import type { Kysely } from 'kysely';
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function fixture() {
  const lease: JobLease = {
    jobId: 'job',
    owner: 'worker',
    leaseToken: 'token',
    expiresAt: new Date(Date.now() + 60000),
    kind: 'work',
    payload: {},
    attempt: 1,
  };
  // Only scheduling is isolated here; claims/renewals/fences have real MySQL coverage.
  const service = new JobsService({} as Kysely<Database>);
  const claim = vi.spyOn(service, 'claim').mockResolvedValue(lease),
    renew = vi.spyOn(service, 'renew').mockResolvedValue(),
    complete = vi.spyOn(service, 'complete').mockResolvedValue();
  return { service, claim, renew, complete };
}
describe('runner timers and lease loss', () => {
  it('does not begin a handler when shutdown arrives during a claim', async () => {
    const f = fixture();
    let resolveClaim: (lease: JobLease | null) => void = () => {};
    const pending = new Promise<JobLease | null>((resolve) => {
      resolveClaim = resolve;
    });
    f.claim.mockReturnValue(pending);
    const handler = vi.fn(async () => {}),
      runner = new JobsRunner(f.service, new Map([['work', handler]]));
    const execution = runner.runOnce(),
      closed = runner.close();
    resolveClaim({
      jobId: 'job',
      owner: 'worker',
      leaseToken: 'token',
      expiresAt: new Date(Date.now() + 60000),
      kind: 'work',
      payload: {},
      attempt: 1,
    });
    await closed;
    expect(await execution).toBe('lease-lost');
    expect(handler).not.toHaveBeenCalled();
  });
  it('renews during long work and refuses completion when renewal fails', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.renew.mockRejectedValue(new Error('connection unavailable secret'));
    let aborted = false;
    const runner = new JobsRunner(
      f.service,
      new Map([
        [
          'work',
          async (_lease, signal) => {
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  resolve();
                },
                { once: true },
              );
            });
          },
        ],
      ]),
    );
    const execution = runner.runOnce();
    await vi.advanceTimersByTimeAsync(20001);
    expect(await execution).toBe('lease-lost');
    expect(aborted).toBe(true);
    expect(f.complete).not.toHaveBeenCalled();
    await runner.close();
  });
  it('does not overlap loops and reports sanitized polling failures', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.claim.mockRejectedValue(new Error('DATABASE_URL=private'));
    const runner = new JobsRunner(f.service, new Map());
    runner.start();
    runner.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.claim).toHaveBeenCalledTimes(1);
    expect(runner.lastLoopError).toBe('JOB_LOOP_UNAVAILABLE');
    f.claim.mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.claim).toHaveBeenCalledTimes(2);
    expect(runner.lastLoopError).toBeNull();
    await runner.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.claim).toHaveBeenCalledTimes(2);
  });
});
