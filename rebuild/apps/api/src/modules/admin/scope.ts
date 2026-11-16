import { ForbiddenException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type {
  ModerationAccess,
  ModerationGroup,
  ModerationPermission,
} from '../../../../../packages/contracts/src/admin.js';
import {
  permits,
  normalizePermissions,
  moderatorGroupId,
} from '../../../../../packages/contracts/src/admin.js';

export { legacyBoardCommunities as boardCommunities } from '../../../../../packages/contracts/src/boards.js';
import { listBoards, requireBoards } from '../communities/board-directory.js';

export async function baseModerationAccess(
  db: Kysely<Database>,
  userId: string,
): Promise<ModerationAccess> {
  const user = await db
    .selectFrom('users')
    .select(['kind', 'deleted_at'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user || user.deleted_at || user.kind !== 'member')
    return { admin: false, owner: false, boards: [] };
  const [platform, groups, directory, overrides] = await Promise.all([
    db.selectFrom('platform_roles').select('role').where('user_id', '=', userId).execute(),
    db
      .selectFrom('moderation_group_members as member')
      .innerJoin('moderation_groups as group', 'group.id', 'member.group_id')
      .select(['group.id', 'group.boards', 'group.permissions', 'member.boards as memberBoards'])
      .where('member.user_id', '=', userId)
      .execute(),
    listBoards(db),
    db.selectFrom('moderator_board_grants').selectAll().where('user_id', '=', userId).execute(),
  ]);
  const admin = platform.some((row) => ['owner', 'admin'].includes(row.role));
  const grants = groups.map((group) => ({
    id: group.id,
    boards: JSON.parse(
      group.id === moderatorGroupId ? (group.memberBoards ?? '[]') : group.boards,
    ) as ModerationGroup['boards'],
    permissions: JSON.parse(group.permissions) as ModerationPermission[],
  }));
  return {
    admin,
    owner: platform.some((row) => row.role === 'owner'),
    boards: directory.flatMap<ModerationAccess['boards'][number]>(({ slug: board }) => {
      if (admin) return [{ board, role: 'admin' }];
      const permissions = normalizePermissions([
        ...new Set(
          grants.flatMap((grant) =>
            grant.boards.some((value) => value === board)
              ? grant.id === moderatorGroupId
                ? (
                    JSON.parse(
                      overrides.find((row) => row.board === board)?.permissions ??
                        JSON.stringify(grant.permissions),
                    ) as ModerationPermission[]
                  ).filter((permission) => permits(grant.permissions, permission))
                : grant.permissions
              : [],
          ),
        ),
      ]);
      const moderator = grants.some(
        (group) => group.id === moderatorGroupId && group.boards.some((value) => value === board),
      );
      return permissions.length
        ? [{ board, role: moderator ? 'moderator' : 'group', permissions }]
        : [];
    }),
  };
}

export async function moderationAccess(
  db: Kysely<Database>,
  userId: string,
): Promise<ModerationAccess> {
  const access = await baseModerationAccess(db, userId);
  if (access.admin) return access;
  const [memberships, penalties, legacyGlobal, legacyLocal] = await Promise.all([
    db
      .selectFrom('community_team_members as member')
      .innerJoin('community_teams as team', 'team.id', 'member.team_id')
      .select(['team.id', 'team.board', 'team.owner_id', 'team.state', 'member.permissions'])
      .where('member.user_id', '=', userId)
      .where('member.state', 'in', ['active', 'exit_requested'])
      .execute(),
    db
      .selectFrom('moderation_penalties')
      .selectAll()
      .where('user_id', '=', userId)
      .where('capability', '!=', 'warning')
      .where('revoked_at', 'is', null)
      .where('superseded_by', 'is', null)
      .where((eb) => eb.or([eb('until_at', 'is', null), eb('until_at', '>', new Date())]))
      .execute(),
    db
      .selectFrom('admin_restrictions')
      .select('user_id')
      .where('user_id', '=', userId)
      .where('until_at', '>', new Date())
      .executeTakeFirst(),
    db
      .selectFrom('community_restrictions')
      .select('board')
      .where('user_id', '=', userId)
      .where('until_at', '>', new Date())
      .execute(),
  ]);
  for (const team of memberships) {
    if (
      team.state !== 'active' ||
      legacyGlobal ||
      legacyLocal.some((row) => row.board === team.board) ||
      penalties.some((row) => !row.board || row.board === team.board)
    )
      continue;
    const owner = await baseModerationAccess(db, team.owner_id);
    const source = owner.boards.find((row) => row.board === team.board && row.role === 'moderator');
    if (!source || !permits(source.permissions, 'teams.manage')) continue;
    const permissions = normalizePermissions(JSON.parse(team.permissions)).filter(
      (permission) =>
        !['teams.manage', 'boards.edit', 'appeals.view', 'appeals.review'].includes(permission) &&
        permits(source.permissions, permission),
    );
    const current = access.boards.find((row) => row.board === team.board);
    if (current)
      current.permissions = normalizePermissions([...(current.permissions || []), ...permissions]);
    else if (permissions.length)
      access.boards.push({ board: team.board, role: 'assistant', permissions });
  }
  return access;
}

export function hasModerationPermission(
  access: ModerationAccess,
  board: string,
  permission?: ModerationPermission,
) {
  return (
    access.admin ||
    access.boards.some(
      (entry) => entry.board === board && (!permission || permits(entry.permissions, permission)),
    )
  );
}

export async function requireScope(
  db: Kysely<Database>,
  userId: string,
  board?: string,
  permission?: ModerationPermission,
) {
  if (board) await requireBoards(db, [board]);
  const access = await moderationAccess(db, userId);
  if (board ? !hasModerationPermission(access, board, permission) : !access.admin)
    throw new ForbiddenException('MODERATION_PERMISSION_REQUIRED');
  return access;
}

export async function protectedPlatformAccounts(db: Kysely<Database>, actor: ModerationAccess, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const roles = await db.selectFrom('users')
    .innerJoin('platform_roles', 'platform_roles.user_id', 'users.id')
    .select(['users.id', 'platform_roles.role'])
    .where('users.id', 'in', userIds)
    .where('users.kind', '=', 'member').where('users.deleted_at', 'is', null).execute();
  return new Set(roles.filter(row => row.role === 'owner' || (!actor.owner && row.role === 'admin')).map(row => row.id));
}

export async function requireAccountManagement(
  db: Kysely<Database>,
  actorId: string,
  userId: string,
  board?: string,
  verifiedActor?: ModerationAccess,
) {
  const actor = verifiedActor ?? await moderationAccess(db, actorId);
  // Platform administrators only need the target's platform protection flags.
  // Do not reconstruct every target's board/team permission graph for this.
  if (actor.admin) {
    if ((await protectedPlatformAccounts(db, actor, [userId])).has(userId))
      throw new ForbiddenException('ADMIN_ACCOUNT_PROTECTED');
    return;
  }
  const [target, assistant] = await Promise.all([
    moderationAccess(db, userId),
    db
    .selectFrom('community_team_members')
    .select('user_id')
    .where('user_id', '=', userId)
    .where('state', 'in', ['active', 'exit_requested'])
    .executeTakeFirst(),
  ]);
  if (
    target.owner ||
    (target.admin && !actor.owner) ||
    (!actor.admin && target.boards.some((entry) => entry.role !== 'assistant')) ||
    (!actor.admin &&
      Boolean(assistant) &&
      !actor.boards.some(
        (entry) => entry.role === 'moderator' && (!board || entry.board === board),
      ))
  )
    throw new ForbiddenException('ADMIN_ACCOUNT_PROTECTED');
}
