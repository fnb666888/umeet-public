import { afterEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { JobsService } from '../src/modules/jobs/jobs.service.js';
import { JobsRunner } from '../src/modules/jobs/jobs.runner.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { OutboxService } from '../src/modules/jobs/outbox.service.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
const limits = { maxFileBytes: 100000000, dailyUploadBytes: 200000000, uploadsEnabled: true };
describe('persistent job execution and operator settings', () => {
  it('quarantines a corrupt persisted payload without blocking later jobs', async () => {
    h = await createTestApp();
    const jobs = new JobsService(h.db);
    const id = await h.db
      .transaction()
      .execute((tx) =>
        jobs.enqueue(tx, { kind: 'receipt', key: 'corrupt', payload: {} }, new Date(0)),
      );
    await h.db.updateTable('jobs').set({ payload: 'not JSON' }).where('id', '=', id).execute();
    expect(await new JobsRunner(jobs, new Map()).runOnce()).toBe('idle');
    const row = await h.db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
    expect(row.state).toBe('failed');
    expect(row.last_error).toBe('INVALID_JOB_PAYLOAD');
  });
  it('boots the API-owned worker and stops it before releasing application resources', async () => {
    h = await createTestApp();
    const jobs = new JobsService(h.db);
    await h.db
      .transaction()
      .execute((tx) =>
        jobs.enqueue(tx, { kind: 'unconfigured-kind', key: 'lifecycle', payload: {} }, new Date()),
      );
    const runtimeApp = await NestFactory.create(
      AppModule.register(h.db, {}, undefined, { runJobs: true }),
      { logger: false },
    );
    try {
      await runtimeApp.init();
      const deadline = Date.now() + 2500;
      let row = await h.db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
      while (row.last_error === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        row = await h.db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
      }
      expect(row.attempts).toBe(1);
      expect(row.last_error).toBe('HANDLER_UNAVAILABLE');
    } finally {
      await runtimeApp.close();
    }
  });
  it('keeps outbox version identity authoritative and rolls back with its business write', async () => {
    h = await createTestApp();
    const outbox = new OutboxService(h.db),
      event = {
        id: 'v1-published',
        kind: 'wiki.changed',
        aggregateId: 'page1',
        versionId: 'v1',
        payload: { aggregateId: 'forged', versionId: 'forged' },
      };
    await expect(
      h.db.transaction().execute(async (tx) => {
        await outbox.recordEvent(tx, event);
        throw new Error('business rollback');
      }),
    ).rejects.toThrow('business rollback');
    expect(await h.db.selectFrom('jobs').selectAll().execute()).toHaveLength(0);
    await h.db.transaction().execute(async (tx) => {
      await outbox.recordEvent(tx, event);
      await outbox.recordEvent(tx, event);
    });
    const rows = await h.db.selectFrom('jobs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload)).toEqual({ aggregateId: 'page1', versionId: 'v1' });
    await expect(
      h.db.transaction().execute((tx) => outbox.recordEvent(tx, { ...event, versionId: 'v2' })),
    ).rejects.toThrow('JOB_KEY_REUSED_WITH_DIFFERENT_INPUT');
  });
  it('renews active leases and fences stale workers from business commits', async () => {
    h = await createTestApp();
    const jobs = new JobsService(h.db),
      now = new Date();
    await h.db
      .transaction()
      .execute((tx) =>
        jobs.enqueue(
          tx,
          { kind: 'receipt', key: 'renew', payload: { text: '长'.repeat(70000) } },
          now,
        ),
      );
    const lease = await jobs.claim('worker1', now);
    if (!lease) throw new Error('missing lease');
    await jobs.renew(lease, new Date(now.getTime() + 30000));
    expect(await jobs.claim('worker2', new Date(now.getTime() + 61000))).toBeNull();
    const replacement = await jobs.claim('worker2', new Date(now.getTime() + 91000));
    if (!replacement) throw new Error('missing replacement');
    await expect(jobs.renew(lease)).rejects.toThrow('STALE_LEASE');
    await expect(
      jobs.withLease(lease, async (tx) => {
        await tx
          .insertInto('audit_events')
          .values({
            id: 'stale-write',
            actor_id: null,
            kind: 'test',
            target_id: 'x',
            reason: 'bad',
          })
          .execute();
      }),
    ).rejects.toThrow('STALE_LEASE');
    expect(
      await h.db.selectFrom('audit_events').selectAll().where('id', '=', 'stale-write').execute(),
    ).toHaveLength(0);
    await jobs.withLease(replacement, async (tx) => {
      await tx
        .insertInto('audit_events')
        .values({
          id: 'valid-write',
          actor_id: null,
          kind: 'test',
          target_id: 'x',
          reason: 'valid',
        })
        .execute();
    });
    expect(
      await h.db.selectFrom('audit_events').selectAll().where('id', '=', 'valid-write').execute(),
    ).toHaveLength(1);
    await expect(
      jobs.withLease(replacement, async (tx) => {
        await tx
          .updateTable('jobs')
          .set({ lease_expires_at: new Date(0) })
          .where('id', '=', replacement.jobId)
          .execute();
        await tx
          .insertInto('audit_events')
          .values({
            id: 'expired-during-work',
            actor_id: null,
            kind: 'test',
            target_id: 'x',
            reason: 'must rollback',
          })
          .execute();
      }),
    ).rejects.toThrow('STALE_LEASE');
    expect(
      await h.db
        .selectFrom('audit_events')
        .selectAll()
        .where('id', '=', 'expired-during-work')
        .execute(),
    ).toHaveLength(0);
  });
  it('eventually dead-letters repeatedly crashed leases', async () => {
    h = await createTestApp();
    const jobs = new JobsService(h.db),
      now = new Date();
    await h.db
      .transaction()
      .execute((tx) => jobs.enqueue(tx, { kind: 'crash', key: 'crash', payload: {} }, now));
    for (let i = 0; i < 5; i++)
      expect((await jobs.claim('worker' + i, new Date(now.getTime() + i * 61000)))?.attempt).toBe(
        i + 1,
      );
    expect(await jobs.claim('worker6', new Date(now.getTime() + 5 * 61000))).toBeNull();
    const row = await h.db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
    expect(row.state).toBe('failed');
    expect(row.last_error).toBe('LEASE_EXPIRED');
  });
  it('stops claiming on shutdown and leaves interrupted work recoverable', async () => {
    h = await createTestApp();
    const jobs = new JobsService(h.db);
    let began: () => void = () => {},
      interrupted = false;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    await h.db
      .transaction()
      .execute((tx) =>
        jobs.enqueue(tx, { kind: 'slow', key: 'shutdown', payload: {} }, new Date()),
      );
    const runner = new JobsRunner(
      jobs,
      new Map([
        [
          'slow',
          async (_lease, signal) => {
            began();
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                'abort',
                () => {
                  interrupted = true;
                  resolve();
                },
                { once: true },
              );
            });
          },
        ],
      ]),
    );
    runner.start();
    await started;
    await runner.close();
    expect(interrupted).toBe(true);
    expect(await runner.runOnce()).toBe('idle');
    expect((await h.db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow()).state).toBe(
      'leased',
    );
    await h.db
      .updateTable('jobs')
      .set({ lease_expires_at: new Date(0) })
      .execute();
    expect(await new JobsRunner(jobs, new Map([['slow', async () => {}]])).runOnce()).toBe(
      'completed',
    );
  });
  it('runs once across workers and recovers from failure in a new runner instance', async () => {
    h = await createTestApp();
    const jobs = new JobsService(h.db);
    let calls = 0;
    await h.db
      .transaction()
      .execute((tx) =>
        jobs.enqueue(
          tx,
          { kind: 'receipt', key: 'receipt:1', payload: { version: 'v1' } },
          new Date(),
        ),
      );
    const handlers = new Map([
      [
        'receipt',
        async () => {
          calls++;
          if (calls === 1) throw new Error('PRIVATE provider token must not be stored');
        },
      ],
    ]);
    expect(await new JobsRunner(jobs, handlers).runOnce()).toBe('retry');
    const failed = await h.db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
    expect(failed.state).toBe('pending');
    expect(failed.last_error).toBe('HANDLER_FAILED');
    expect(failed.available_at.getTime()).toBeGreaterThan(Date.now());
    await h.db
      .updateTable('jobs')
      .set({ available_at: new Date(0) })
      .execute();
    const runners = [new JobsRunner(jobs, handlers), new JobsRunner(jobs, handlers)];
    expect((await Promise.all(runners.map((r) => r.runOnce()))).sort()).toEqual([
      'completed',
      'idle',
    ]);
    expect(calls).toBe(2);
    expect((await h.db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow()).state).toBe(
      'completed',
    );
  });
  it('rejects an expired lease even before another worker reclaims it', async () => {
    h = await createTestApp();
    const jobs = new JobsService(h.db),
      now = new Date();
    await h.db
      .transaction()
      .execute((tx) =>
        jobs.enqueue(tx, { kind: 'receipt', key: 'lease-expired', payload: {} }, now),
      );
    const lease = await jobs.claim('worker', now);
    if (!lease) throw new Error('missing lease');
    await h.db
      .updateTable('jobs')
      .set({ lease_expires_at: new Date(0) })
      .where('id', '=', lease.jobId)
      .execute();
    await expect(jobs.complete(lease)).rejects.toThrow('STALE_LEASE');
    await expect(jobs.retry(lease, 'HANDLER_FAILED', now)).rejects.toThrow('STALE_LEASE');
  });
  it('moves repeated handler failures to the dead-letter state without leaking exceptions', async () => {
    h = await createTestApp();
    const jobs = new JobsService(h.db);
    await h.db
      .transaction()
      .execute((tx) =>
        jobs.enqueue(
          tx,
          { kind: 'unconfigured-kind', key: 'missing-handler', payload: {} },
          new Date(),
        ),
      );
    const runner = new JobsRunner(jobs, new Map());
    for (let i = 0; i < 5; i++) {
      await h.db
        .updateTable('jobs')
        .set({ available_at: new Date(0) })
        .execute();
      expect(await runner.runOnce()).toBe('retry');
    }
    const row = await h.db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
    expect(row.state).toBe('failed');
    expect(row.attempts).toBe(5);
    expect(row.last_error).toBe('HANDLER_UNAVAILABLE');
    expect(await runner.runOnce()).toBe('idle');
  });
  it('stores limits with revision checks and audit; rejects guests and non-admins', async () => {
    h = await createTestApp();
    const service = new SettingsService(h.db),
      auth = new PasswordAuthService(h.db);
    const registered = await auth.register(
      { username: 'settings_owner', password: 'Settings Owner Password!' },
      'settings-test',
    );
    const member = { actor: registered.actor, requestId: 'settings' };
    expect(await service.getLimits()).toEqual({ revision: 0, limits });
    await expect(
      service.updateLimits(member, { baseRevision: 0, limits, reason: 'change limit' }),
    ).rejects.toThrow('PLATFORM_PERMISSION_REQUIRED');
    const guest = await auth.guest('settings-test');
    await expect(
      service.updateLimits(
        { actor: guest.actor, requestId: 'guest' },
        { baseRevision: 0, limits, reason: 'change limit' },
      ),
    ).rejects.toThrow('REGISTERED_ACCOUNT_REQUIRED');
    const ctx = { ...member, actor: { ...registered.actor, platformRoles: ['owner'] } };
    const changes = await Promise.allSettled([
      service.updateLimits(ctx, {
        baseRevision: 0,
        limits: { ...limits, uploadsEnabled: false },
        reason: 'Pause new uploads',
      }),
      service.updateLimits(ctx, {
        baseRevision: 0,
        limits: { ...limits, maxFileBytes: 50000000 },
        reason: 'Reduce upload size',
      }),
    ]);
    expect(changes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(changes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const saved = await service.getLimits();
    expect(saved.revision).toBe(1);
    expect(await new SettingsService(h.db).getLimits()).toEqual(saved);
    expect(
      await h.db
        .selectFrom('audit_events')
        .selectAll()
        .where('kind', '=', 'settings.limits-updated')
        .execute(),
    ).toHaveLength(1);
    // Limits are read from MySQL by consumers, with no redundant notification job.
    expect(await h.db.selectFrom('jobs').selectAll().execute()).toHaveLength(0);
  });
  it('requires server-resolved admin roles, safe job views and audited explicit retries', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db),
      s = h.app.getHttpServer();
    const member = await auth.register(
      { username: 'jobs_admin', password: 'Settings Owner Password!' },
      'admin-test',
    );
    await request(s).get('/api/v1/admin/jobs').expect(401);
    await request(s)
      .get('/api/v1/admin/jobs')
      .set('Authorization', 'Bearer ' + member.token)
      .expect(403);
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: member.actor.userId, role: 'admin' })
      .execute();
    const jobs = new JobsService(h.db);
    const id = await h.db
      .transaction()
      .execute((tx) =>
        jobs.enqueue(
          tx,
          { kind: 'receipt', key: 'secret:key', payload: { secret: 'never-return-this' } },
          new Date(),
        ),
      );
    await h.db
      .updateTable('jobs')
      .set({ state: 'failed', attempts: 5, last_error: 'HANDLER_FAILED' })
      .where('id', '=', id)
      .execute();
    const list = await request(s)
      .get('/api/v1/admin/jobs?state=failed')
      .set('Authorization', 'Bearer ' + member.token)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.text).not.toContain('never-return-this');
    expect(list.text).not.toContain('secret:key');
    expect(list.body.items[0].attempts).toBe(5);
    const stats = await request(s)
      .get('/api/v1/admin/jobs/stats')
      .set('Authorization', 'Bearer ' + member.token)
      .expect(200);
    expect(stats.body.failed).toBe(1);
    expect(stats.body.pending).toBe(0);
    await request(s)
      .post('/api/v1/admin/jobs/' + id + '/retry')
      .set('Authorization', 'Bearer ' + member.token)
      .send({ reason: '' })
      .expect(400);
    await request(s)
      .post('/api/v1/admin/jobs/' + id + '/retry')
      .set('Authorization', 'Bearer ' + member.token)
      .send({ reason: 'Provider configuration has been fixed' })
      .expect(201);
    expect(
      (await h.db.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow())
        .state,
    ).toBe('pending');
    await request(s)
      .post('/api/v1/admin/jobs/' + id + '/retry')
      .set('Authorization', 'Bearer ' + member.token)
      .send({ reason: 'Duplicate retry' })
      .expect(409);
    expect(
      await h.db.selectFrom('audit_events').selectAll().where('kind', '=', 'job.retried').execute(),
    ).toHaveLength(1);
    const defaults = await request(s)
      .get('/api/v1/admin/settings/limits')
      .set('Authorization', 'Bearer ' + member.token)
      .expect(200);
    expect(defaults.body.revision).toBe(0);
    await request(s)
      .put('/api/v1/admin/settings/limits')
      .set('Authorization', 'Bearer ' + member.token)
      .send({
        baseRevision: 0,
        limits: { ...limits, uploadsEnabled: false },
        reason: 'Storage budget pause',
      })
      .expect(200);
    await request(s)
      .put('/api/v1/admin/settings/limits')
      .set('Authorization', 'Bearer ' + member.token)
      .send({ baseRevision: 0, limits, reason: 'Stale browser edit' })
      .expect(409);
  });
});
