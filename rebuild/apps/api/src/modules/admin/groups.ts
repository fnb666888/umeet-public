import { syncCommunityTeams } from './team-sync.js';
import { inviteModerator, cancelModeratorInvitations } from './moderator-invitations.js';
import { requireSingleBoardModerator } from './board-moderators.js';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import {
  moderationPermissions,
  moderatorGroupId,
  normalizePermissions,
  type ModerationGroup,
} from '../../../../../packages/contracts/src/admin.js';
import { requireScope } from './scope.js';
import { requireCapability } from './restrictions.js';

export async function listModerationGroups(
  db: Kysely<Database>,
  board?: ModerationGroup['boards'][number],
) {
  const [groups, memberships, platform, users] = await Promise.all([
    db.selectFrom('moderation_groups').selectAll().orderBy('name').execute(),
    db
      .selectFrom('moderation_group_members as member')
      .innerJoin('users as user', 'user.id', 'member.user_id')
      .select(['member.group_id', 'user.id', 'user.handle', 'user.nickname', 'member.boards'])
      .where('user.deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('platform_roles as role')
      .innerJoin('users as user', 'user.id', 'role.user_id')
      .select(['user.id', 'user.handle', 'user.nickname', 'role.role'])
      .where('role.role', 'in', ['admin', 'owner'])
      .where('user.deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('users')
      .select(['id', 'handle', 'nickname'])
      .where('kind', '=', 'member')
      .where('deleted_at', 'is', null)
      .execute(),
  ]);
  const handles = (rows: { handle: string | null }[]) =>
    [...new Set(rows.flatMap((row) => (row.handle ? [row.handle] : [])))].sort();
  const invitations = await db.selectFrom('community_requests as request')
    .innerJoin('users as user', 'user.id', 'request.user_id')
    .select(['request.id', 'request.user_id as userId', 'request.board', 'user.nickname', 'user.handle'])
    .where('request.kind', '=', 'moderator_invitation').where('request.state', '=', 'pending')
    .where('user.deleted_at', 'is', null).execute();
  const builtin: ModerationGroup[] = [
    {
      id: 'everyone',
      name: '普通用户',
      builtin: true,
      boards: [],
      permissions: [],
      members: handles(users),
      memberDetails: users.filter((user): user is typeof user & { handle: string } =>
        Boolean(user.handle),
      ),
    },
    {
      id: 'admin',
      name: '全站管理员',
      builtin: true,
      boards: [],
      permissions: [...moderationPermissions],
      members: handles(platform),
      memberDetails: [
        ...new Map(
          platform
            .filter((user) => user.handle)
            .map((user) => [
              user.id,
              { id: user.id, handle: user.handle!, nickname: user.nickname },
            ]),
        ).values(),
      ],
      owners: handles(platform.filter((row) => row.role === 'owner')),
    },
  ];
  return [
    ...builtin,
    ...groups
      .sort((a, b) => Number(b.id === moderatorGroupId) - Number(a.id === moderatorGroupId))
      .map((group): ModerationGroup => ({
        id: group.id,
        ...(group.id === moderatorGroupId ? { builtin: true } : {}),
        name: group.name,
        ...(group.id === moderatorGroupId ? { invitations: invitations.map(row => ({ ...row, handle: row.handle || '' })) } : {}),
        boards:
          group.id === moderatorGroupId
            ? [
                ...new Set(
                  memberships
                    .filter((member) => member.group_id === group.id)
                    .flatMap((member) => JSON.parse(member.boards ?? '[]')),
                ),
              ]
            : JSON.parse(group.boards),
        permissions: normalizePermissions(JSON.parse(group.permissions)),
        members: handles(memberships.filter((member) => member.group_id === group.id)),
        memberDetails: memberships
          .filter((member) => member.group_id === group.id && member.handle)
          .map((member) => ({
            id: member.id,
            handle: member.handle!,
            nickname: member.nickname,
            ...(group.id === moderatorGroupId ? { boards: JSON.parse(member.boards ?? '[]') } : {}),
          })),
      })),
  ];
}

export async function saveModerationGroup(
  db: Kysely<Database>,
  actorId: string,
  input: Omit<ModerationGroup, 'id' | 'builtin' | 'members'> & {
    members?: string[] | undefined;
    id?: string | undefined;
    expectedMembers?: string[] | undefined;
  },
) {
  const id = input.id || randomUUID();
  return db.transaction().execute(async (tx) => {
    await lockGroupChanges(tx, actorId);
    const prior = await tx
      .selectFrom('moderation_groups')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (input.id && !prior) throw new NotFoundException('GROUP_NOT_FOUND');
    const existing = await tx
      .selectFrom('moderation_groups')
      .select('id')
      .where('name', '=', input.name)
      .where('id', '!=', id)
      .executeTakeFirst();
    if (
      existing ||
      (id !== moderatorGroupId && ['全站管理员', '社区主', '版主', '普通用户'].includes(input.name))
    )
      throw new ConflictException('GROUP_NAME_EXISTS');
    if (id === moderatorGroupId && input.name !== '版主')
      throw new BadRequestException('BUILTIN_GROUP_FIXED');
    const handles = [...new Set((input.members || []).map((handle) => handle.toLowerCase()))];
    const members = handles.length
      ? await tx
          .selectFrom('users')
          .select('id')
          .where('handle', 'in', handles)
          .where('kind', '=', 'member')
          .where('deleted_at', 'is', null)
          .forUpdate()
          .execute()
      : [];
    if (members.length !== handles.length) throw new BadRequestException('GROUP_MEMBER_NOT_FOUND');
    const previousMembers = await tx
      .selectFrom('moderation_group_members as member')
      .innerJoin('users as user', 'user.id', 'member.user_id')
      .select(['member.user_id', 'user.handle', 'member.boards'])
      .where('member.group_id', '=', id)
      .where('user.deleted_at', 'is', null)
      .execute();
    if (id === moderatorGroupId && input.members !== undefined &&
      members.some(member => !previousMembers.some(previous => previous.user_id === member.id)))
      throw new BadRequestException('MODERATOR_INVITATION_REQUIRED');
    if (
      input.expectedMembers &&
      [...input.expectedMembers].sort().join('\n') !==
        previousMembers
          .map((member) => member.handle)
          .sort()
          .join('\n')
    )
      throw new ConflictException('GROUP_MEMBERS_CHANGED');
    const row = {
      name: input.name,
      boards: JSON.stringify([...new Set(input.boards)]),
      permissions: JSON.stringify(normalizePermissions(input.permissions)),
    };
    if (prior) await tx.updateTable('moderation_groups').set(row).where('id', '=', id).execute();
    else
      await tx
        .insertInto('moderation_groups')
        .values({ id, ...row })
        .execute();
    if (input.members !== undefined) {
      await tx.deleteFrom('moderation_group_members').where('group_id', '=', id).execute();
      if (id === moderatorGroupId) for (const removed of previousMembers.filter(previous => !members.some(member => member.id === previous.user_id))) await tx.deleteFrom('moderator_board_grants').where('user_id', '=', removed.user_id).execute();
      if (members.length)
        await tx
          .insertInto('moderation_group_members')
          .values(
            members.map((member) => ({
              group_id: id,
              user_id: member.id,
              boards:
                id === moderatorGroupId
                  ? (previousMembers.find((prior) => prior.user_id === member.id)?.boards ?? '[]')
                  : null,
            })),
          )
          .execute();
    }
    await tx
      .insertInto('admin_actions')
      .values({
        id: randomUUID(),
        actor_id: actorId,
        target: id,
        action: 'group.save',
        request_hash: '',
        reason: '保存群组权限：' + input.name,
        created_at: new Date(),
        before_data: JSON.stringify({ group: prior, members: previousMembers }),
        after_data: JSON.stringify({
          group: row,
          members: input.members === undefined ? previousMembers : members,
        }),
      })
      .execute();
    await requireSingleBoardModerator(tx);
    await syncCommunityTeams(tx);
    return { id };
  });
}

async function lockGroupChanges(tx: Transaction<Database>, actorId: string) {
  await tx
    .selectFrom('demo_content')
    .select('id')
    .where('id', '=', 'global')
    .forUpdate()
    .executeTakeFirstOrThrow();
  await requireScope(tx, actorId);
  await requireCapability(tx, actorId, 'suspension');
}

export async function setModerationMembership(
  db: Kysely<Database>,
  actorId: string,
  input: { groupId: string; userId: string; member: boolean },
) {
  return changeGroupMembers(db, actorId, { ...input, userIds: [input.userId] });
}

export async function changeGroupMembers(
  db: Kysely<Database>,
  actorId: string,
  {
    groupId,
    userIds,
    member,
    boards,
  }: {
    groupId: string;
    userIds: string[];
    member: boolean;
    boards?: ModerationGroup['boards'] | undefined;
  },
) {
  return db.transaction().execute(async (tx) => {
    await lockGroupChanges(tx, actorId);
    for (const userId of [...new Set(userIds)]) {
      const group = await tx
        .selectFrom('moderation_groups')
        .select(['name', 'boards'])
        .where('id', '=', groupId)
        .executeTakeFirst();
      if (groupId === 'admin') {
        const access = await requireScope(tx, actorId);
        if (!access.owner) throw new ForbiddenException('SITE_OWNER_REQUIRED');
        const owner = await tx
          .selectFrom('platform_roles')
          .select('user_id')
          .where('user_id', '=', userId)
          .where('role', '=', 'owner')
          .executeTakeFirst();
        if (owner && !member) throw new ConflictException('SITE_OWNER_PROTECTED');
      } else if (!group) throw new NotFoundException('GROUP_NOT_FOUND');
      const user = await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', userId)
        .where('kind', '=', 'member')
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!user) throw new NotFoundException('USER_NOT_FOUND');
      if (groupId === moderatorGroupId && member) {
        if (!boards?.length) throw new BadRequestException('MODERATOR_BOARDS_REQUIRED');
        for (const board of [...new Set(boards)]) await inviteModerator(tx, actorId, userId, board);
        continue;
      }
      if (groupId === moderatorGroupId && !member)
        await cancelModeratorInvitations(tx, actorId, userId);
      if (groupId === 'admin') {
        if (member)
          await tx
            .insertInto('platform_roles')
            .values({ user_id: userId, role: 'admin' })
            .onDuplicateKeyUpdate({ role: 'admin' })
            .execute();
        else
          await tx
            .deleteFrom('platform_roles')
            .where('user_id', '=', userId)
            .where('role', '=', 'admin')
            .execute();
        await tx
          .insertInto('admin_actions')
          .values({
            id: randomUUID(),
            actor_id: actorId,
            target: userId,
            action: 'group.member',
            request_hash: '',
            reason: member ? '添加全站管理员' : '移除全站管理员',
            created_at: new Date(),
            before_data: '{}',
            after_data: JSON.stringify({ groupId, member }),
          })
          .execute();
        continue;
      }
      const membership = tx
        .selectFrom('moderation_group_members')
        .select('user_id')
        .where('group_id', '=', groupId);
      const existing = await membership.where('user_id', '=', userId).executeTakeFirst();
      if (member === Boolean(existing)) continue;
      if (member) {
        if ((await membership.limit(200).execute()).length >= 200)
          throw new ConflictException('GROUP_MEMBER_LIMIT');
        await tx
          .insertInto('moderation_group_members')
          .values({
            group_id: groupId,
            user_id: userId,
            boards:
              groupId === moderatorGroupId
                ? JSON.stringify(boards === undefined ? [] : [...new Set(boards)])
                : null,
          })
          .execute();
      } else {
        await tx
          .deleteFrom('moderation_group_members')
          .where('group_id', '=', groupId)
          .where('user_id', '=', userId)
          .execute();
        if (groupId === moderatorGroupId) await tx.deleteFrom('moderator_board_grants').where('user_id', '=', userId).execute();
      }
      await tx
        .insertInto('admin_actions')
        .values({
          id: randomUUID(),
          actor_id: actorId,
          target: userId,
          action: 'group.member',
          request_hash: '',
          reason: (member ? '加入群组 ' : '移出群组 ') + group!.name,
          created_at: new Date(),
          before_data: JSON.stringify({ groupId, member: !member }),
          after_data: JSON.stringify({
            groupId,
            member,
            ...(groupId === moderatorGroupId && member ? { boards: boards ?? [] } : {}),
          }),
        })
        .execute();
    }
    await requireSingleBoardModerator(tx);
    await syncCommunityTeams(tx);
    return { member };
  });
}

export async function assignModeratorBoards(
  db: Kysely<Database>,
  actorId: string,
  userIds: string[],
  boards: ModerationGroup['boards'],
) {
  return db.transaction().execute(async (tx) => {
    await lockGroupChanges(tx, actorId);
    for (const userId of [...new Set(userIds)]) {
      const member = await tx
        .selectFrom('moderation_group_members')
        .selectAll()
        .where('group_id', '=', moderatorGroupId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!member) throw new NotFoundException('GROUP_MEMBER_NOT_FOUND');
      const previous: string[] = JSON.parse(member.boards || '[]');
      for (const board of boards.filter(board => !previous.includes(board)))
        await inviteModerator(tx, actorId, userId, board);
      const pending = await tx.selectFrom('community_requests').select('board')
        .where('kind', '=', 'moderator_invitation').where('user_id', '=', userId)
        .where('state', '=', 'pending').execute();
      await cancelModeratorInvitations(tx, actorId, userId, pending.map(row => row.board).filter(board => !boards.includes(board)));
      const value = JSON.stringify(previous.filter(board => boards.includes(board)));
      if (member.boards === value) continue;
      await tx
        .updateTable('moderation_group_members')
        .set({ boards: value })
        .where('group_id', '=', moderatorGroupId)
        .where('user_id', '=', userId)
        .execute();
      await tx
        .insertInto('admin_actions')
        .values({
          id: randomUUID(),
          actor_id: actorId,
          target: userId,
          action: 'group.member.boards',
          request_hash: '',
          reason: '调整版主负责社区',
          created_at: new Date(),
          before_data: JSON.stringify({ boards: member.boards ? JSON.parse(member.boards) : [] }),
          after_data: JSON.stringify({ boards: [...new Set(boards)] }),
        })
        .execute();
    }
    await requireSingleBoardModerator(tx);
    await syncCommunityTeams(tx);
    return { updated: userIds.length };
  });
}

export async function deleteModerationGroup(db: Kysely<Database>, actorId: string, id: string) {
  return db.transaction().execute(async (tx) => {
    await lockGroupChanges(tx, actorId);
    if (id === moderatorGroupId) throw new ConflictException('BUILTIN_GROUP_FIXED');
    const group = await tx
      .selectFrom('moderation_groups')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!group) throw new NotFoundException('GROUP_NOT_FOUND');
    const members = await tx
      .selectFrom('moderation_group_members')
      .selectAll()
      .where('group_id', '=', id)
      .execute();
    await tx.deleteFrom('moderation_group_members').where('group_id', '=', id).execute();
    await tx.deleteFrom('moderation_groups').where('id', '=', id).execute();
    await requireSingleBoardModerator(tx);
    await syncCommunityTeams(tx);
    await tx
      .insertInto('admin_actions')
      .values({
        id: randomUUID(),
        actor_id: actorId,
        target: id,
        action: 'group.delete',
        request_hash: '',
        reason: '删除群组 ' + group.name,
        created_at: new Date(),
        before_data: JSON.stringify({ group, members }),
        after_data: '{}',
      })
      .execute();
    return { ok: true };
  });
}

export async function transferSiteOwnership(db: Kysely<Database>, actorId: string, userId: string) {
  return db.transaction().execute(async (tx) => {
    await lockGroupChanges(tx, actorId);
    const access = await requireScope(tx, actorId);
    if (!access.owner) throw new ForbiddenException('SITE_OWNER_REQUIRED');
    if (actorId === userId) throw new BadRequestException('ALREADY_SITE_OWNER');
    const user = await tx
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .where('kind', '=', 'member')
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!user) throw new NotFoundException('USER_NOT_FOUND');
    const blocked = await tx
      .selectFrom('moderation_penalties')
      .select('id')
      .where('user_id', '=', userId)
      .where('board', 'is', null)
      .where('capability', 'in', ['suspension','deactivation'])
      .where('revoked_at', 'is', null)
      .where((eb) => eb.or([eb('until_at', 'is', null), eb('until_at', '>', new Date())]))
      .executeTakeFirst();
    if (blocked) throw new ConflictException('USER_SUSPENDED');
    await tx.deleteFrom('platform_roles').where('role', '=', 'owner').execute();
    for (const id of [actorId, userId])
      await tx
        .insertInto('platform_roles')
        .values({ user_id: id, role: 'admin' })
        .onDuplicateKeyUpdate({ role: 'admin' })
        .execute();
    await tx.insertInto('platform_roles').values({ user_id: userId, role: 'owner' }).execute();
    await tx
      .insertInto('admin_actions')
      .values({
        id: randomUUID(),
        actor_id: actorId,
        target: userId,
        action: 'site.transfer',
        request_hash: '',
        reason: '转让站点',
        before_data: JSON.stringify({ owner: actorId }),
        after_data: JSON.stringify({ owner: userId }),
        created_at: new Date(),
      })
      .execute();
    return { ok: true };
  });
}
