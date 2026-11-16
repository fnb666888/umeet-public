import { ForbiddenException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { boardSlug } from '../../../../../packages/contracts/src/boards.js';

export async function activePenalties(db: Kysely<Database>, userId: string, now = new Date()) {
  return db
    .selectFrom('moderation_penalties')
    .selectAll()
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('superseded_by', 'is', null)
    .where((eb) => eb.or([eb('until_at', 'is', null), eb('until_at', '>', now)]))
    .execute();
}

export async function requireCapability(
  db: Kysely<Database>,
  userId: string,
  capability: string,
  boards: string[] = [],
) {
  const penalty = (await activePenalties(db, userId)).find(
    (p) =>
      (p.capability === capability ||
        p.capability === 'suspension' ||
        p.capability === 'deactivation' ||
        (p.capability === 'participation' &&
          (['publish', 'interact', 'wiki'].includes(capability) ||
            (!p.board && capability === 'messages')))) &&
      (!p.board || boards.includes(p.board)),
  );
  if (penalty)
    throw new ForbiddenException({
      code: 'ACCOUNT_RESTRICTED',
      message:
        (penalty.board ? '当前社区' : '全站') +
        (penalty.capability === 'deactivation' ? '账号已停用' : '参与权限受限') +
        '，' +
        (penalty.until_at ? '至 ' + penalty.until_at.toLocaleString('zh-CN') : '永久') +
        '，原因 ' +
        penalty.reason,
    });
}

export async function requireCommunityUnrestricted(
  db: Kysely<Database>,
  userId: string,
  communityId: string,
  capability = 'publish',
) {
  const community = await db
    .selectFrom('communities')
    .select('slug')
    .where('id', '=', communityId)
    .executeTakeFirst();
  const board = community ? boardSlug(community.slug) : undefined;
  await requireUnrestricted(db, userId, board ? [board] : [], capability);
}

export async function requireUnrestricted(
  db: Kysely<Database>,
  userId: string,
  boards: string[] = [],
  capability = 'publish',
) {
  await requireCapability(db, userId, capability, boards);
  const restriction = await db
    .selectFrom('admin_restrictions')
    .selectAll()
    .where('user_id', '=', userId)
    .where('until_at', '>', new Date())
    .executeTakeFirst();
  if (restriction)
    throw new ForbiddenException({
      code: 'ACCOUNT_RESTRICTED',
      message: '账号禁言至 ' + restriction.until_at.toISOString() + '，原因 ' + restriction.reason,
    });
  if (!boards.length) return;
  const scoped = await db
    .selectFrom('community_restrictions')
    .selectAll()
    .where('user_id', '=', userId)
    .where('board', 'in', boards)
    .where('until_at', '>', new Date())
    .executeTakeFirst();
  if (scoped)
    throw new ForbiddenException({
      code: 'ACCOUNT_RESTRICTED',
      message: '本社区禁言至 ' + scoped.until_at.toISOString() + '，原因 ' + scoped.reason,
    });
}
