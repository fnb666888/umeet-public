import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  JobListQuerySchema,
  JobStateSchema,
  ReasonSchema,
  type CursorPage,
  type JobStats,
  type JobSummary,
  type RequestContext,
} from '../../../../../packages/contracts/src/index.js';
import { requirePlatformAdmin } from '../identity/permissions.service.js';
import { AuditService } from '../audit/audit.service.js';
export type JobInput = { kind: string; key: string; payload: Record<string, unknown> };
export type JobLease = {
  jobId: string;
  owner: string;
  leaseToken: string;
  expiresAt: Date;
  kind: string;
  payload: Record<string, unknown>;
  attempt: number;
};
export class JobsService {
  constructor(private readonly db: Kysely<Database>) {}
  async enqueue(tx: Transaction<Database>, input: JobInput, now = new Date()): Promise<string> {
    z.string().min(1).max(200).parse(input.key);
    z.string().min(1).max(80).parse(input.kind);
    z.record(z.string(), z.unknown()).parse(input.payload);
    const payload = JSON.stringify(input.payload);
    z.string().max(500000).parse(payload);
    const id = randomUUID();
    await tx
      .insertInto('jobs')
      .values({
        id,
        kind: input.kind,
        business_key: input.key,
        payload,
        state: 'pending',
        available_at: now,
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
        last_error: null,
      })
      .onDuplicateKeyUpdate({ business_key: input.key })
      .execute();
    const existing = await tx
      .selectFrom('jobs')
      .select(['id', 'kind', 'payload'])
      .where('business_key', '=', input.key)
      .executeTakeFirstOrThrow();
    if (existing.kind !== input.kind || existing.payload !== payload)
      throw new Error('JOB_KEY_REUSED_WITH_DIFFERENT_INPUT');
    return existing.id;
  }
  async claim(worker: string, now: Date): Promise<JobLease | null> {
    z.string().min(1).max(100).parse(worker);
    return this.db.transaction().execute(async (tx) => {
      // A crash is an attempt too; repeatedly crashing tasks must eventually stop.
      const row = await tx
        .selectFrom('jobs')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb.and([eb('state', '=', 'pending'), eb('available_at', '<=', now)]),
            eb.and([eb('state', '=', 'leased'), eb('lease_expires_at', '<=', now)]),
          ]),
        )
        .orderBy('available_at')
        .orderBy('id')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!row) return null;
      if (row.attempts >= 5) {
        await tx
          .updateTable('jobs')
          .set({
            state: 'failed',
            last_error: 'LEASE_EXPIRED',
            lease_owner: null,
            lease_token: null,
            lease_expires_at: null,
          })
          .where('id', '=', row.id)
          .execute();
        return null;
      }
      let payload: Record<string, unknown>;
      try {
        payload = z.record(z.string(), z.unknown()).parse(JSON.parse(row.payload));
      } catch {
        await tx
          .updateTable('jobs')
          .set({
            state: 'failed',
            last_error: 'INVALID_JOB_PAYLOAD',
            lease_owner: null,
            lease_token: null,
            lease_expires_at: null,
          })
          .where('id', '=', row.id)
          .execute();
        return null;
      }
      const leaseToken = randomUUID(),
        expiresAt = new Date(now.getTime() + 60000);
      await tx
        .updateTable('jobs')
        .set({
          state: 'leased',
          attempts: row.attempts + 1,
          lease_owner: worker,
          lease_token: leaseToken,
          lease_expires_at: expiresAt,
        })
        .where('id', '=', row.id)
        .execute();
      return {
        jobId: row.id,
        owner: worker,
        leaseToken,
        expiresAt,
        kind: row.kind,
        payload,
        attempt: row.attempts + 1,
      };
    });
  }
  async renew(lease: JobLease, now = new Date()): Promise<void> {
    const result = await this.db
      .updateTable('jobs')
      .set({ lease_expires_at: new Date(now.getTime() + 60000) })
      .where('id', '=', lease.jobId)
      .where('state', '=', 'leased')
      .where('lease_owner', '=', lease.owner)
      .where('lease_token', '=', lease.leaseToken)
      .where('lease_expires_at', '>', now)
      .executeTakeFirst();
    if (result.numUpdatedRows !== 1n) throw new Error('STALE_LEASE');
  }
  async complete(lease: JobLease, now = new Date()): Promise<void> {
    const result = await this.db
      .updateTable('jobs')
      .set({ state: 'completed', lease_owner: null, lease_token: null, lease_expires_at: null })
      .where('id', '=', lease.jobId)
      .where('state', '=', 'leased')
      .where('lease_owner', '=', lease.owner)
      .where('lease_token', '=', lease.leaseToken)
      .where('lease_expires_at', '>', now)
      .executeTakeFirst();
    if (result.numUpdatedRows !== 1n) throw new Error('STALE_LEASE');
  }
  async retry(lease: JobLease, errorCode: string, now: Date): Promise<void> {
    const safeError = ['HANDLER_FAILED', 'HANDLER_UNAVAILABLE', 'LEASE_EXPIRED'].includes(errorCode)
      ? errorCode
      : 'HANDLER_FAILED';
    const result = await this.db
      .updateTable('jobs')
      .set({
        state: lease.attempt >= 5 ? 'failed' : 'pending',
        available_at: new Date(now.getTime() + Math.min(3600, 2 ** lease.attempt) * 1000),
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
        last_error: safeError,
      })
      .where('id', '=', lease.jobId)
      .where('state', '=', 'leased')
      .where('lease_owner', '=', lease.owner)
      .where('lease_token', '=', lease.leaseToken)
      .where('lease_expires_at', '>', now)
      .executeTakeFirst();
    if (result.numUpdatedRows !== 1n) throw new Error('STALE_LEASE');
  }
  // DB effects use this fencing transaction; external effects still need provider idempotency.
  async withLease<T>(
    lease: JobLease,
    work: (tx: Transaction<Database>) => Promise<T>,
    now = new Date(),
  ): Promise<T> {
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom('jobs')
        .select('id')
        .where('id', '=', lease.jobId)
        .where('state', '=', 'leased')
        .where('lease_owner', '=', lease.owner)
        .where('lease_token', '=', lease.leaseToken)
        .where('lease_expires_at', '>', now)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw new Error('STALE_LEASE');
      const result = await work(tx);
      const current = await tx
        .selectFrom('jobs')
        .select('id')
        .where('id', '=', lease.jobId)
        .where('state', '=', 'leased')
        .where('lease_owner', '=', lease.owner)
        .where('lease_token', '=', lease.leaseToken)
        .where('lease_expires_at', '>', new Date())
        .executeTakeFirst();
      if (!current) throw new Error('STALE_LEASE');
      return result;
    });
  }
  async list(ctx: RequestContext, input: unknown): Promise<CursorPage<JobSummary>> {
    requirePlatformAdmin(ctx);
    const data = JobListQuerySchema.parse(input);
    let query = this.db
      .selectFrom('jobs')
      .select(['id', 'kind', 'state', 'attempts', 'available_at', 'lease_expires_at', 'last_error'])
      .orderBy('id')
      .limit(51);
    if (data.state) query = query.where('state', '=', data.state);
    if (data.after) query = query.where('id', '>', data.after);
    const rows = await query.execute();
    return {
      items: rows.slice(0, 50).map((row) => ({
        id: row.id,
        kind: row.kind,
        state: JobStateSchema.parse(row.state),
        attempts: row.attempts,
        availableAt: row.available_at.toISOString(),
        leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
        lastError: row.last_error,
      })),
      nextCursor: rows.length > 50 ? rows[49]!.id : null,
    };
  }
  async stats(ctx: RequestContext, now = new Date()): Promise<JobStats> {
    requirePlatformAdmin(ctx);
    const rows = await this.db
      .selectFrom('jobs')
      .select([
        'state',
        sql<number>`count(*)`.as('count'),
        sql<Date | null>`min(available_at)`.as('oldest'),
      ])
      .groupBy('state')
      .execute();
    const overdue = await this.db
      .selectFrom('jobs')
      .select(sql<number>`count(*)`.as('count'))
      .where('state', '=', 'leased')
      .where('lease_expires_at', '<=', now)
      .executeTakeFirstOrThrow();
    return {
      pending: Number(rows.find((r) => r.state === 'pending')?.count ?? 0),
      leased: Number(rows.find((r) => r.state === 'leased')?.count ?? 0),
      completed: Number(rows.find((r) => r.state === 'completed')?.count ?? 0),
      failed: Number(rows.find((r) => r.state === 'failed')?.count ?? 0),
      overdueLeases: Number(overdue.count),
      oldestPendingAt: rows.find((r) => r.state === 'pending')?.oldest?.toISOString() ?? null,
    };
  }
  async retryFailed(ctx: RequestContext, id: string, reason: string): Promise<void> {
    const actor = requirePlatformAdmin(ctx);
    ReasonSchema.parse(reason);
    await this.db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom('jobs')
        .select(['id', 'state', 'last_error', 'attempts'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw new NotFoundException('JOB_NOT_FOUND');
      if (row.state !== 'failed') throw new ConflictException('JOB_NOT_FAILED');
      await tx
        .updateTable('jobs')
        .set({
          state: 'pending',
          attempts: 0,
          available_at: new Date(),
          lease_owner: null,
          lease_token: null,
          lease_expires_at: null,
        })
        .where('id', '=', id)
        .execute();
      await new AuditService().append(tx, {
        actorId: actor.userId,
        kind: 'job.retried',
        targetId: id,
        reason: JSON.stringify({
          reason,
          previousAttempts: row.attempts,
          previousError: row.last_error,
        }),
      });
    });
  }
}
