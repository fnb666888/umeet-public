import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { baseModerationAccess } from './scope.js';
import {
  normalizePermissions,
  permits,
  type ModerationPermission,
} from '../../../../../packages/contracts/src/admin.js';
import { requireApplicationEligibility } from '../communities/application-policy.js';

const excluded = new Set(['teams.manage', 'boards.edit', 'appeals.view', 'appeals.review']);
export const assistantPermissions = (permissions: ModerationPermission[]) =>
  normalizePermissions(permissions).filter((permission) => !excluded.has(permission));

async function notify(tx: Transaction<Database>, userId: string, text: string, detail: string) {
  await tx
    .insertInto('admin_notifications')
    .values({
      id: randomUUID(),
      user_id: userId,
      text,
      detail,
      href: '/#/my-applications',
      created_at: new Date(),
    })
    .execute();
}

async function audit(
  tx: Transaction<Database>,
  actor: string,
  teamId: string,
  action: string,
  before: unknown,
  after: unknown,
  requestHash = '',
) {
  await tx
    .insertInto('admin_actions')
    .values({
      id: randomUUID(),
      actor_id: actor,
      target: teamId,
      action,
      request_hash: requestHash,
      reason: '',
      before_data: JSON.stringify(before),
      after_data: JSON.stringify(after),
      created_at: new Date(),
    })
    .execute();
}

export class CommunityTeamsService {
  constructor(private readonly db: Kysely<Database>) {}

  async list(actorId: string, board?: string) {
    const access = await baseModerationAccess(this.db, actorId);
    const teams = await this.db.selectFrom('community_teams').selectAll().execute();
    const members = await this.db
      .selectFrom('community_team_members as member')
      .innerJoin('users as user', 'user.id', 'member.user_id')
      .select([
        'member.team_id',
        'member.user_id',
        'member.permissions',
        'member.state',
        'member.version',
        'user.nickname',
        'user.handle',
      ])
      .execute();
    return Promise.all(
      teams
        .filter(
          (team) =>
            (!board || team.board === board) &&
            (access.admin ||
              access.boards.some(
                (entry) => entry.board === team.board && entry.role === 'moderator',
              )),
        )
        .map(async (team) => ({
          ...team,
          canManage: access.admin || team.owner_id === actorId,
          canTransfer: access.admin,
          availablePermissions: assistantPermissions(
            (await baseModerationAccess(this.db, team.owner_id)).boards.find(
              (entry) => entry.board === team.board && entry.role === 'moderator',
            )?.permissions || [],
          ),
          members: members
            .filter((member) => member.team_id === team.id)
            .map((member) => ({
              ...member,
              permissions: JSON.parse(member.permissions) as ModerationPermission[],
            })),
        })),
    );
  }

  async mine(userId: string) {
    return this.db
      .selectFrom('community_team_members as member')
      .innerJoin('community_teams as team', 'team.id', 'member.team_id')
      .select([
        'member.team_id',
        'member.permissions',
        'member.state',
        'member.version',
        'team.name',
        'team.board',
        'team.state as teamState',
      ])
      .where('member.user_id', '=', userId)
      .execute();
  }

  async create(actorId: string, input: { id: string; board: string; name: string }) {
    return this.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('demo_content')
        .select('id')
        .where('id', '=', 'global')
        .forUpdate()
        .executeTakeFirstOrThrow();
      await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', actorId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const access = await baseModerationAccess(tx, actorId);
      const grant = access.boards.find(
        (entry) => entry.board === input.board && entry.role === 'moderator',
      );
      if (!grant || !permits(grant.permissions, 'teams.manage'))
        throw new ForbiddenException('MODERATOR_REQUIRED');
      const prior = await tx
        .selectFrom('community_teams')
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirst();
      if (prior) {
        if (prior.owner_id !== actorId || prior.board !== input.board || prior.name !== input.name)
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return prior;
      }
      const value = {
        id: input.id,
        board: input.board,
        name: input.name,
        owner_id: actorId,
        state: 'active',
        version: 1,
      };
      await tx.insertInto('community_teams').values(value).execute();
      await audit(tx, actorId, value.id, 'team.create', null, value);
      return value;
    });
  }

  async manage(
    actorId: string,
    input: {
      teamId: string;
      version: number;
      action: 'invite' | 'permissions' | 'remove' | 'approve-exit' | 'transfer';
      userId: string;
      permissions: ModerationPermission[];
    },
  ) {
    return this.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('demo_content')
        .select('id')
        .where('id', '=', 'global')
        .forUpdate()
        .executeTakeFirstOrThrow();
      const team = await tx
        .selectFrom('community_teams')
        .selectAll()
        .where('id', '=', input.teamId)
        .forUpdate()
        .executeTakeFirst();
      if (!team) throw new NotFoundException('TEAM_NOT_FOUND');
      const actor = await baseModerationAccess(tx, actorId);
      if (!actor.admin && team.owner_id !== actorId)
        throw new ForbiddenException('TEAM_OWNER_REQUIRED');
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ actorId, ...input }))
        .digest('hex');
      const completed = await tx
        .selectFrom('admin_actions')
        .select('id')
        .where('actor_id', '=', actorId)
        .where('request_hash', '=', requestHash)
        .executeTakeFirst();
      if (completed) return { version: input.version + 1 };
      if (team.version !== input.version) throw new ConflictException('TEAM_VERSION_CONFLICT');
      if (input.action === 'transfer') {
        if (!actor.admin) throw new ForbiddenException('PLATFORM_PERMISSION_REQUIRED');
        const owner = await baseModerationAccess(tx, input.userId);
        const grant = owner.boards.find(
          (entry) => entry.board === team.board && entry.role === 'moderator',
        );
        if (!grant || !permits(grant.permissions, 'teams.manage'))
          throw new ForbiddenException('MODERATOR_REQUIRED');
        const members = await tx
          .selectFrom('community_team_members')
          .selectAll()
          .where('team_id', '=', team.id)
          .execute();
        for (const member of members) {
          const permissions = assistantPermissions(JSON.parse(member.permissions)).filter(
            (permission) => permits(grant.permissions, permission),
          );
          await tx
            .updateTable('community_team_members')
            .set({ permissions: JSON.stringify(permissions), version: member.version + 1 })
            .where('team_id', '=', team.id)
            .where('user_id', '=', member.user_id)
            .execute();
        }
        await tx
          .updateTable('community_teams')
          .set({ owner_id: input.userId, state: 'active', version: team.version + 1 })
          .where('id', '=', team.id)
          .execute();
      } else {
        const prior = await tx
          .selectFrom('community_team_members')
          .selectAll()
          .where('team_id', '=', team.id)
          .where('user_id', '=', input.userId)
          .executeTakeFirst();
        if (input.action === 'invite' || input.action === 'permissions') {
          const owner = await baseModerationAccess(tx, team.owner_id);
          const grant = owner.boards.find(
            (entry) => entry.board === team.board && entry.role === 'moderator',
          );
          if (team.state !== 'active' || !grant || !permits(grant.permissions, 'teams.manage'))
            throw new ForbiddenException('TEAM_SUSPENDED');
          const permissions = assistantPermissions(input.permissions);
          if (
            permissions.some((permission) => !permits(grant.permissions, permission)) ||
            input.permissions.some((permission) => excluded.has(permission))
          )
            throw new ForbiddenException('PERMISSION_ESCALATION');
          if (input.action === 'invite') {
            if (prior) throw new ConflictException('ALREADY_INVITED');
            await requireApplicationEligibility(tx, input.userId);
            await tx
              .insertInto('community_team_members')
              .values({
                team_id: team.id,
                user_id: input.userId,
                permissions: JSON.stringify(permissions),
                state: 'invited',
                version: 1,
              })
              .execute();
          } else {
            if (!prior) throw new NotFoundException('TEAM_MEMBER_NOT_FOUND');
            await tx
              .updateTable('community_team_members')
              .set({ permissions: JSON.stringify(permissions), version: prior.version + 1 })
              .where('team_id', '=', team.id)
              .where('user_id', '=', input.userId)
              .execute();
          }
        } else {
          if (!prior || (input.action === 'approve-exit' && prior.state !== 'exit_requested'))
            throw new ConflictException('TEAM_MEMBER_STATE_CONFLICT');
          await tx
            .deleteFrom('community_team_members')
            .where('team_id', '=', team.id)
            .where('user_id', '=', input.userId)
            .execute();
        }
        await tx
          .updateTable('community_teams')
          .set({ version: team.version + 1 })
          .where('id', '=', team.id)
          .execute();
        await notify(tx, input.userId, '管理团队成员变更', team.name + ' · ' + input.action);
      }
      await audit(tx, actorId, team.id, 'team.' + input.action, team, input, requestHash);
      return { version: team.version + 1 };
    });
  }

  async respond(
    userId: string,
    input: { teamId: string; version: number; action: 'accept' | 'decline' | 'request-exit' },
  ) {
    return this.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('demo_content')
        .select('id')
        .where('id', '=', 'global')
        .forUpdate()
        .executeTakeFirstOrThrow();
      const team = await tx
        .selectFrom('community_teams')
        .selectAll()
        .where('id', '=', input.teamId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const member = await tx
        .selectFrom('community_team_members')
        .selectAll()
        .where('team_id', '=', team.id)
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      if (
        member.version === input.version + 1 &&
        ((input.action === 'accept' && member.state === 'active') ||
          (input.action === 'request-exit' && member.state === 'exit_requested'))
      )
        return { version: member.version };
      if (member.version !== input.version)
        throw new ConflictException('INVITATION_VERSION_CONFLICT');
      if (input.action === 'accept') {
        if (member.state !== 'invited') throw new ConflictException('INVITATION_NOT_PENDING');
        await requireApplicationEligibility(tx, userId);
        const owner = await baseModerationAccess(tx, team.owner_id);
        const grant = owner.boards.find(
          (entry) => entry.board === team.board && entry.role === 'moderator',
        );
        if (
          team.state !== 'active' ||
          !grant ||
          !permits(grant.permissions, 'teams.manage') ||
          JSON.parse(member.permissions).some(
            (permission: ModerationPermission) => !permits(grant.permissions, permission),
          )
        )
          throw new ConflictException('INVITATION_PERMISSIONS_CHANGED');
      } else if (input.action === 'request-exit' && member.state !== 'active')
        throw new ConflictException('TEAM_MEMBER_STATE_CONFLICT');
      else if (input.action === 'decline' && member.state !== 'invited')
        throw new ConflictException('INVITATION_NOT_PENDING');
      if (input.action === 'decline')
        await tx
          .deleteFrom('community_team_members')
          .where('team_id', '=', team.id)
          .where('user_id', '=', userId)
          .execute();
      else
        await tx
          .updateTable('community_team_members')
          .set({
            state: input.action === 'accept' ? 'active' : 'exit_requested',
            version: member.version + 1,
          })
          .where('team_id', '=', team.id)
          .where('user_id', '=', userId)
          .execute();
      await tx
        .updateTable('community_teams')
        .set({ version: team.version + 1 })
        .where('id', '=', team.id)
        .execute();
      await audit(tx, userId, team.id, 'team.' + input.action, member, input);
      await notify(tx, team.owner_id, '管理团队成员回复', team.name + ' · ' + input.action);
      return { version: member.version + 1 };
    });
  }
}
