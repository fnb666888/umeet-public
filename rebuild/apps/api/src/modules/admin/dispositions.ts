import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type {
  DispositionEffect,
  DispositionInput,
} from '../../../../../packages/contracts/src/admin.js';
import { requireAccountManagement, requireScope } from './scope.js';

export async function dispositionEffects(
  db: Kysely<Database>,
  actionId?: string,
): Promise<DispositionEffect[]> {
  let query = db.selectFrom('moderation_action_effects').selectAll();
  if (actionId) query = query.where('action_id', '=', actionId);
  const effects = await query.execute();
  if (!effects.length) return [];
  const penalties = await db.selectFrom('moderation_penalties').selectAll().execute();
  return effects.map((effect) => {
    const penalty = penalties.find((item) => item.id === effect.penalty_id);
    const current =
      penalty &&
      penalties.find(
        (item) =>
          item.user_id === penalty.user_id &&
          item.board === penalty.board &&
          item.capability === penalty.capability &&
          !item.revoked_at &&
          !item.superseded_by &&
          (!item.until_at || item.until_at > new Date()),
      );
    const snapshot = JSON.parse(effect.after_data);
    return {
      id: effect.id,
      actionId: effect.action_id,
      type: effect.type,
      target: effect.target,
      board: effect.board,
      penaltyId: effect.penalty_id,
      reason: snapshot.reason || '',
      until: snapshot.until || null,
      status:
        effect.reversed_by || penalty?.revoked_at
          ? 'revoked'
          : penalty?.superseded_by
            ? 'superseded'
            : penalty?.until_at && penalty.until_at <= new Date()
              ? 'expired'
              : ['warning', 'restriction.release'].includes(effect.type)
                ? 'recorded'
                : 'active',
      currentVersion: current?.id || null,
    };
  });
}

export async function applyDisposition(
  tx: Transaction<Database>,
  actorId: string,
  userId: string,
  input: DispositionInput,
  actionId: string,
  reason: string,
  checkVersion = true,
) {
  const board = input.scope === 'community' ? input.board : undefined;
  await requireScope(tx, actorId, board, 'users.manage');
  await requireAccountManagement(tx, actorId, userId, board);
  const user = await tx
    .selectFrom('users')
    .selectAll()
    .where('id', '=', userId)
    .forUpdate()
    .executeTakeFirst();
  if (!user || user.deleted_at || user.kind !== 'member')
    throw new NotFoundException('USER_NOT_FOUND');
  if (input.kind === 'deactivation' && board)
    throw new ForbiddenException('PLATFORM_SCOPE_REQUIRED');
  const existing = await tx
    .selectFrom('moderation_penalties')
    .selectAll()
    .where('user_id', '=', userId)
    .where('board', board ? '=' : 'is', board || null)
    .where('capability', '=', input.kind)
    .where('revoked_at', 'is', null)
    .where('superseded_by', 'is', null)
    .where((eb) => eb.or([eb('until_at', 'is', null), eb('until_at', '>', new Date())]))
    .executeTakeFirst();
  if (input.kind !== 'warning' && checkVersion && (existing?.id || null) !== input.expectedVersion)
    throw new ConflictException('DISPOSITION_VERSION_CONFLICT');
  const id = actionId;
  const until =
    input.kind !== 'warning' && input.hours ? new Date(Date.now() + input.hours * 3600000) : null;
  if (existing && input.kind !== 'warning')
    await tx
      .updateTable('moderation_penalties')
      .set({ superseded_by: id })
      .where('id', '=', existing.id)
      .execute();
  await tx
    .insertInto('moderation_penalties')
    .values({
      id,
      user_id: userId,
      board: board || null,
      capability: input.kind,
      reason,
      until_at: until,
      revoked_at: null,
      created_at: new Date(),
      source_action_id: actionId,
      superseded_by: null,
    })
    .execute();
  await tx
    .insertInto('moderation_action_effects')
    .values({
      id: id + ':user',
      action_id: actionId,
      type: input.kind,
      target: userId,
      board: board || null,
      penalty_id: id,
      before_data: JSON.stringify(existing || null),
      after_data: JSON.stringify({ reason, until: until?.toISOString() || null }),
      reversed_by: null,
      created_at: new Date(),
    })
    .execute();
  return {
    id,
    user_id: userId,
    board: board || null,
    capability: input.kind,
    reason,
    until_at: until,
    previous: existing || null,
  };
}

export async function revokeDisposition(
  tx: Transaction<Database>,
  actorId: string,
  penaltyId: string,
  board?: string,
  expectedVersion?: string,
) {
  const penalty = await tx
    .selectFrom('moderation_penalties')
    .selectAll()
    .where('id', '=', penaltyId)
    .executeTakeFirst();
  if (!penalty || (board && penalty.board !== board))
    throw new NotFoundException('PENALTY_NOT_FOUND');
  await requireScope(tx, actorId, penalty.board || undefined, 'users.manage');
  await requireAccountManagement(tx, actorId, penalty.user_id, penalty.board ?? undefined);
  await tx
    .selectFrom('users')
    .select('id')
    .where('id', '=', penalty.user_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const current = await tx
    .selectFrom('moderation_penalties')
    .selectAll()
    .where('id', '=', penaltyId)
    .executeTakeFirstOrThrow();
  if (current.revoked_at) throw new ConflictException('PENALTY_ALREADY_REVOKED');
  if (current.superseded_by || (expectedVersion && expectedVersion !== current.id))
    throw new ConflictException('DISPOSITION_VERSION_CONFLICT');
  await tx
    .updateTable('moderation_penalties')
    .set({ revoked_at: new Date() })
    .where('id', '=', penaltyId)
    .execute();
  return current;
}

export async function recordContentEffect(
  tx: Transaction<Database>,
  actionId: string,
  target: string,
  board: string | null,
  before: unknown,
  reason: string,
) {
  await tx
    .insertInto('moderation_action_effects')
    .values({
      id: actionId + ':content',
      action_id: actionId,
      type: 'content.delete',
      target,
      board,
      penalty_id: null,
      before_data: JSON.stringify(before ?? null),
      after_data: JSON.stringify({ reason }),
      reversed_by: null,
      created_at: new Date(),
    })
    .execute();
}

export async function reviewEffects(
  tx: Transaction<Database>,
  actorId: string,
  original: Selectable<Database['admin_actions']>,
  decisions: { effectId: string; outcome: 'upheld' | 'reversed'; releaseCurrentVersion?: string }[],
  reviewId: string,
) {
  const effects = await tx
    .selectFrom('moderation_action_effects')
    .selectAll()
    .where('action_id', '=', original.id)
    .execute();
  if (
    effects.length !== decisions.length ||
    effects.some((effect) => !decisions.some((decision) => decision.effectId === effect.id))
  )
    throw new ConflictException('INVALID_APPEAL_DECISIONS');
  for (const effect of effects) {
    await requireScope(tx, actorId, effect.board || undefined, 'appeals.review');
    if (effect.penalty_id) await requireAccountManagement(tx, actorId, effect.target, effect.board ?? undefined);
  }
  for (const effect of effects) {
    const decision = decisions.find((item) => item.effectId === effect.id)!;
    if (decision.outcome !== 'reversed' || effect.reversed_by) continue;
    if (effect.penalty_id) {
      // Revoking an old version never changes a replacement.
      await tx
        .updateTable('moderation_penalties')
        .set({ revoked_at: new Date() })
        .where('id', '=', effect.penalty_id)
        .execute();
      if (decision.releaseCurrentVersion && decision.releaseCurrentVersion !== effect.penalty_id) {
        const replacement = await tx
          .selectFrom('moderation_penalties')
          .selectAll()
          .where('id', '=', decision.releaseCurrentVersion)
          .executeTakeFirst();
        if (
          !replacement ||
          replacement.user_id !== effect.target ||
          replacement.board !== effect.board ||
          replacement.capability !== effect.type
        )
          throw new ConflictException('DISPOSITION_VERSION_CONFLICT');
        const replacementAction = await tx
          .selectFrom('admin_actions')
          .select('actor_id')
          .where('id', '=', replacement.source_action_id || replacement.id)
          .executeTakeFirst();
        if (replacementAction?.actor_id === actorId)
          throw new ForbiddenException('INDEPENDENT_REVIEWER_REQUIRED');
        await revokeDisposition(
          tx,
          actorId,
          replacement.id,
          effect.board || undefined,
          replacement.id,
        );
        await tx
          .insertInto('moderation_action_effects')
          .values({
            ...effect,
            id: randomUUID(),
            action_id: reviewId,
            type: 'restriction.release',
            penalty_id: replacement.id,
            before_data: JSON.stringify(replacement),
            after_data: JSON.stringify({ reason: '申诉复核解除后续限制' }),
            reversed_by: null,
            created_at: new Date(),
          })
          .execute();
      }
    } else if (effect.type === 'content.delete') {
      const later = await tx
        .selectFrom('admin_actions')
        .select('id')
        .where('target', '=', effect.target)
        .where('action', 'in', ['visibility', 'case.resolve'])
        .where('created_at', '>=', original.created_at)
        .where('id', '!=', original.id)
        .executeTakeFirst();
      if (later) throw new ConflictException('NEWER_DISPOSITION_EXISTS');
      await tx
        .insertInto('admin_visibility')
        .values({ target: effect.target, hidden: 0 })
        .onDuplicateKeyUpdate({ hidden: 0 })
        .execute();
    }
    await tx
      .updateTable('moderation_action_effects')
      .set({ reversed_by: reviewId })
      .where('id', '=', effect.id)
      .execute();
  }
}
