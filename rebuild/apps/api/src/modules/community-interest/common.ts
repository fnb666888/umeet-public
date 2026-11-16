import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import { contentBoards, interestBoards } from '../../../../../packages/contracts/src/interest.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { requireMember, requirePlatformAdmin } from '../identity/permissions.service.js';
import { requireUnrestricted } from '../admin/restrictions.js';
import { DemoSnapshotsService } from '../demo/demo-snapshots.service.js';

export type InterestDb = Kysely<Database>;
export type InterestTx = Transaction<Database>;
export type InterestRequest = { headers: { authorization?: string } };
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('INVALID_INPUT');
  return result.data;
}
export async function context(
  db: InterestDb,
  req: InterestRequest,
  member = false,
): Promise<RequestContext> {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : '';
  const actor = await new PasswordAuthService(db).optionalActor(token, true);
  const ctx = { actor, requestId: randomUUID() };
  if (member) requireMember(ctx);
  return ctx;
}
export async function writeActor(
  db: InterestDb,
  ctx: RequestContext,
  boards: string[] = [],
  capability = 'interact',
) {
  const actor = requireMember(ctx);
  await requireUnrestricted(db, actor.userId, boards, capability);
  return actor;
}
export async function adminActor(db: InterestDb, ctx: RequestContext) {
  const actor = requirePlatformAdmin(ctx);
  await requireUnrestricted(db, actor.userId);
  return actor;
}
export async function visiblePost(db: InterestDb, id: string, userId: string | null) {
  const snapshot = await new DemoSnapshotsService(db).get(userId, false);
  const post = snapshot.content.posts.find((p) => p.id === id);
  if (!post) throw new NotFoundException('POST_NOT_FOUND');
  return post;
}
export async function seedInterestBoards(db: InterestDb) {
  for (const [offset, board] of [...contentBoards, ...interestBoards].entries()) {
    const existing = await db
      .selectFrom('communities')
      .select('id')
      .where('slug', '=', board.slug)
      .executeTakeFirst();
    if (existing) continue;
    const id = 'interest-' + board.slug;
    await db
      .insertInto('communities')
      .values({
        id,
        ...board,
        is_default: 0,
        display_order:
          offset < contentBoards.length ? 90 + offset : 100 + offset - contentBoards.length,
      })
      .onDuplicateKeyUpdate({ slug: board.slug })
      .execute();
    await db
      .insertInto('wiki_spaces')
      .values({ id: 'wiki-' + id, community_id: id })
      .onDuplicateKeyUpdate({ community_id: id })
      .execute();
  }
}
export async function audit(
  db: InterestDb | InterestTx,
  actorId: string,
  kind: string,
  targetId: string,
  reason: string,
) {
  await db
    .insertInto('audit_events')
    .values({
      id: randomUUID(),
      actor_id: actorId,
      kind,
      target_id: targetId,
      reason,
      created_at: new Date(),
    })
    .execute();
}
export function businessDay(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function pageQuery(cursor: unknown, limit: unknown) {
  const n = limit === undefined ? 20 : Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new BadRequestException('INVALID_LIMIT');
  if (
    cursor !== undefined &&
    (typeof cursor !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[a-zA-Z0-9_-]{1,80}$/.test(cursor))
  )
    throw new BadRequestException('INVALID_CURSOR');
  const parts = typeof cursor === 'string' ? cursor.split('|') : [];
  const at = parts[0] ? new Date(parts[0]) : null;
  if (at && !Number.isFinite(at.getTime())) throw new BadRequestException('INVALID_CURSOR');
  return { limit: n, at, id: parts[1] || '' };
}
export function rejectUnsafeText(value: string) {
  if (/[\u0000]/.test(value)) throw new BadRequestException('INVALID_TEXT');
  return value;
}
export function requireOwner(actual: string, expected: string) {
  if (actual !== expected) throw new ForbiddenException('OWNER_REQUIRED');
}
