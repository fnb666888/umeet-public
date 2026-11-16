import { ConflictException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { moderatorGroupId } from '../../../../../packages/contracts/src/admin.js';

export async function boardModerators(db: Kysely<Database>) {
  const members = await db
    .selectFrom('moderation_group_members as member')
    .innerJoin('users as user', 'user.id', 'member.user_id')
    .select(['member.user_id', 'member.boards'])
    .where('member.group_id', '=', moderatorGroupId)
    .where('user.deleted_at', 'is', null)
    .execute();
  return members.flatMap((member) =>
    (JSON.parse(member.boards || '[]') as string[]).map((board) => ({
      board,
      userId: member.user_id,
    })),
  );
}

export async function requireSingleBoardModerator(db: Kysely<Database>) {
  const grants = await boardModerators(db);
  const boards = new Set<string>();
  for (const grant of grants) {
    if (boards.has(grant.board)) throw new ConflictException('BOARD_MODERATOR_EXISTS');
    boards.add(grant.board);
  }
}
