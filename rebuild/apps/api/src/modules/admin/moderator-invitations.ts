import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import {
  moderatorGroupId,
  normalizePermissions,
} from '../../../../../packages/contracts/src/admin.js';
import { boardModerators, requireSingleBoardModerator } from './board-moderators.js';
import { requireScope } from './scope.js';
import { requireApplicationEligibility } from '../communities/application-policy.js';
import { requireBoards } from '../communities/board-directory.js';

export async function inviteModerator(
  tx: Transaction<Database>,
  actorId: string,
  userId: string,
  board: string,
) {
  await requireBoards(tx, [board]);
  await requireApplicationEligibility(tx, userId);
  const current = (await boardModerators(tx)).find((entry) => entry.board === board);
  if (current) {
    if (current.userId === userId) return;
    throw new ConflictException('BOARD_MODERATOR_EXISTS');
  }
  const existing = await tx
    .selectFrom('community_requests')
    .select('id')
    .where('kind', '=', 'moderator_invitation')
    .where('user_id', '=', userId)
    .where('board', '=', board)
    .where('state', '=', 'pending')
    .executeTakeFirst();
  if (existing) return;
  const group = await tx
    .selectFrom('moderation_groups')
    .select('permissions')
    .where('id', '=', moderatorGroupId)
    .executeTakeFirstOrThrow();
  const id = randomUUID();
  await tx
    .insertInto('community_requests')
    .values({
      id,
      user_id: userId,
      kind: 'moderator_invitation',
      board,
      state: 'pending',
      version: 1,
      created_at: new Date(),
      data: JSON.stringify({
        inviterId: actorId,
        permissions: normalizePermissions(JSON.parse(group.permissions)),
      }),
    })
    .execute();
  await record(tx, actorId, userId, id, board, 'invite');
}

async function record(
  tx: Transaction<Database>,
  actorId: string,
  userId: string,
  id: string,
  board: string,
  action: string,
) {
  await tx
    .insertInto('community_request_events')
    .values({
      id: randomUUID(),
      request_id: id,
      actor_id: actorId,
      action,
      reason: '',
      created_at: new Date(),
    })
    .execute();
  await tx
    .insertInto('admin_actions')
    .values({
      id: randomUUID(),
      actor_id: actorId,
      target: userId,
      board,
      action: 'moderator.invitation.' + action,
      reason: '',
      request_hash: '',
      before_data: '{}',
      after_data: JSON.stringify({ invitationId: id, board, action }),
      created_at: new Date(),
    })
    .execute();
  await tx
    .insertInto('admin_notifications')
    .values({
      id: randomUUID(),
      user_id: userId,
      text: action === 'invite' ? '版主邀请' : '版主邀请已更新',
      detail:
        board +
        ' · ' +
        ({ invite: '待接受', accept: '已接受', decline: '已拒绝', cancel: '已撤回' }[action] ||
          action),
      href: '/#/my-applications',
      created_at: new Date(),
    })
    .execute();
}

export async function cancelModeratorInvitations(
  tx: Transaction<Database>,
  actorId: string,
  userId: string,
  boards?: string[],
) {
  let query = tx
    .selectFrom('community_requests')
    .selectAll()
    .where('kind', '=', 'moderator_invitation')
    .where('user_id', '=', userId)
    .where('state', '=', 'pending');
  if (boards) {
    if (!boards.length) return;
    query = query.where('board', 'in', boards);
  }
  for (const row of await query.execute()) {
    await tx
      .updateTable('community_requests')
      .set({ state: 'withdrawn', version: row.version + 1 })
      .where('id', '=', row.id)
      .execute();
    await record(tx, actorId, userId, row.id, row.board, 'cancel');
  }
}

export async function respondModeratorInvitation(
  db: Kysely<Database>,
  userId: string,
  input: { id: string; version: number; action: 'accept' | 'decline' },
) {
  return db.transaction().execute(async (tx) => {
    await tx
      .selectFrom('demo_content')
      .select('id')
      .where('id', '=', 'global')
      .forUpdate()
      .executeTakeFirstOrThrow();
    const row = await tx
      .selectFrom('community_requests')
      .selectAll()
      .where('id', '=', input.id)
      .forUpdate()
      .executeTakeFirst();
    if (!row || row.kind !== 'moderator_invitation')
      throw new NotFoundException('INVITATION_NOT_FOUND');
    if (row.user_id !== userId) throw new ForbiddenException('INVITATION_NOT_YOURS');
    const state = input.action === 'accept' ? 'approved' : 'rejected';
    if (row.state === state && row.version === input.version + 1) return { version: row.version };
    if (row.version !== input.version || row.state !== 'pending')
      throw new ConflictException('INVITATION_NOT_PENDING');
    if (input.action === 'accept') {
      const data = JSON.parse(row.data);
      await requireScope(tx, data.inviterId);
      await requireApplicationEligibility(tx, userId);
      await requireBoards(tx, [row.board]);
      if (
        (await boardModerators(tx)).some(
          (entry) => entry.board === row.board && entry.userId !== userId,
        )
      )
        throw new ConflictException('BOARD_MODERATOR_EXISTS');
      const member = await tx
        .selectFrom('moderation_group_members')
        .select('boards')
        .where('group_id', '=', moderatorGroupId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      const boards = JSON.stringify([
        ...new Set([...(JSON.parse(member?.boards || '[]') as string[]), row.board]),
      ]);
      if (!member && (await tx.selectFrom('moderation_group_members').select('user_id')
        .where('group_id', '=', moderatorGroupId).limit(200).execute()).length >= 200)
        throw new ConflictException('GROUP_MEMBER_LIMIT');
      await tx
        .insertInto('moderation_group_members')
        .values({ group_id: moderatorGroupId, user_id: userId, boards })
        .onDuplicateKeyUpdate({ boards })
        .execute();
      const group = await tx
        .selectFrom('moderation_groups')
        .select('permissions')
        .where('id', '=', moderatorGroupId)
        .executeTakeFirstOrThrow();
      const allowed: string[] = normalizePermissions(JSON.parse(group.permissions));
      const permissions = JSON.stringify(
        normalizePermissions(data.permissions).filter((permission) => allowed.includes(permission)),
      );
      await tx
        .insertInto('moderator_board_grants')
        .values({ user_id: userId, board: row.board, permissions })
        .onDuplicateKeyUpdate({ permissions })
        .execute();
      await requireSingleBoardModerator(tx);
    }
    await tx
      .updateTable('community_requests')
      .set({ state, version: row.version + 1 })
      .where('id', '=', row.id)
      .execute();
    await record(tx, userId, userId, row.id, row.board, input.action);
    return { version: row.version + 1 };
  });
}

export async function withdrawModeratorInvitation(
  db: Kysely<Database>,
  actorId: string,
  id: string,
) {
  return db.transaction().execute(async (tx) => {
    await tx
      .selectFrom('demo_content')
      .select('id')
      .where('id', '=', 'global')
      .forUpdate()
      .executeTakeFirstOrThrow();
    await requireScope(tx, actorId);
    const row = await tx
      .selectFrom('community_requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row || row.kind !== 'moderator_invitation')
      throw new NotFoundException('INVITATION_NOT_FOUND');
    if (row.state !== 'pending') throw new ConflictException('INVITATION_NOT_PENDING');
    await cancelModeratorInvitations(tx, actorId, row.user_id, [row.board]);
    return { withdrawn: true };
  });
}
