import { ForbiddenException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { activePenalties } from '../admin/restrictions.js';

export async function getApplicationEligibility(
  db: Kysely<Database>,
  userId: string,
  now = new Date(),
) {
  const user = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  const policy = await db
    .selectFrom('runtime_settings')
    .select('value')
    .where('id', '=', 'community-application-policy')
    .executeTakeFirst();
  const thresholds = policy
    ? (JSON.parse(policy.value) as { days: number; posts: number })
    : { days: 30, posts: 5 };
  const posts = await db
    .selectFrom('demo_entities')
    .select(['id', 'data'])
    .where('kind', '=', 'post')
    .execute();
  const hidden = await db
    .selectFrom('admin_visibility')
    .select('target')
    .where('hidden', '=', 1)
    .execute();
  const hiddenIds = new Set(hidden.map((row) => row.target));
  const demoPosts = posts.filter(
    (row) => JSON.parse(row.data).authorId === userId && !hiddenIds.has(row.id),
  );
  const nativePosts = await db
    .selectFrom('discussion_posts')
    .select('id')
    .where('author_id', '=', userId)
    .where('state', '=', 'public')
    .execute();
  const validPosts = new Set([
    ...demoPosts.map((row) => row.id.replace(/^post:/, '')),
    ...nativePosts.map((row) => row.id),
  ]).size;
  const registeredDays = Math.max(
    0,
    Math.floor((now.getTime() - user.created_at.getTime()) / 86400000),
  );
  const legacyGlobal = await db
    .selectFrom('admin_restrictions')
    .select('user_id')
    .where('user_id', '=', userId)
    .where('until_at', '>', now)
    .executeTakeFirst();
  const legacyLocal = await db
    .selectFrom('community_restrictions')
    .select('user_id')
    .where('user_id', '=', userId)
    .where('until_at', '>', now)
    .executeTakeFirst();
  const blockReasons = [
    ...(user.kind !== 'member' || user.deleted_at ? ['账号不可用'] : []),
    ...(registeredDays < thresholds.days ? ['注册未满 ' + thresholds.days + ' 天'] : []),
    ...(validPosts < thresholds.posts ? ['有效发帖不足 ' + thresholds.posts + ' 篇'] : []),
    ...((await activePenalties(db, userId, now)).some(
      (penalty) => penalty.capability !== 'warning',
    ) ||
    legacyGlobal ||
    legacyLocal
      ? ['存在生效中的账号限制']
      : []),
  ];
  return {
    eligible: !blockReasons.length,
    registeredDays,
    validPosts,
    requiredDays: thresholds.days,
    requiredPosts: thresholds.posts,
    blockReasons,
  };
}

export async function requireApplicationEligibility(db: Kysely<Database>, userId: string) {
  const result = await getApplicationEligibility(db, userId);
  if (!result.eligible)
    throw new ForbiddenException({
      code: 'APPLICATION_INELIGIBLE',
      message: result.blockReasons.join('，'),
      eligibility: result,
    });
}
