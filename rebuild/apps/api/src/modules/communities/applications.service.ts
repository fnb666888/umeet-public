import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { moderationAccess, requireScope } from '../admin/scope.js';
import { requireApplicationEligibility, getApplicationEligibility } from './application-policy.js';
import { requireBoards } from './board-directory.js';
import { communitySlug } from '../../../../../packages/contracts/src/boards.js';
import { boardModerators, requireSingleBoardModerator } from '../admin/board-moderators.js';
import { assistantPermissions } from '../admin/community-teams.js';
import { permits } from '../../../../../packages/contracts/src/admin.js';
import {
  moderatorGroupId,
  normalizePermissions,
  type ModerationPermission,
} from '../../../../../packages/contracts/src/admin.js';

export type ApplicationData = {
  name: string;
  description: string;
  rules: string[];
  reason: string;
  plan: string;
  experience: string;
  applyModerator: boolean;
  moderatorReason?: string | undefined;
};
function validateMaterials(kind: string, data: ApplicationData) {
  if (
    !data.reason.trim() ||
    (kind === 'board' && (!data.description.trim() || !data.rules.length)) ||
    ((kind === 'moderator' || data.applyModerator) && !data.plan.trim())
  )
    throw new BadRequestException('APPLICATION_MATERIALS_REQUIRED');
}
export class ApplicationsService {
  constructor(private readonly db: Kysely<Database>) {}

  async list(actorId: string, admin = false, board?: string) {
    if (admin) await requireScope(this.db, actorId);
    if (board) {
      const access = await moderationAccess(this.db, actorId);
      if (!access.boards.some((entry) => entry.board === board && entry.role === 'moderator'))
        throw new ForbiddenException('MODERATOR_REQUIRED');
    }
    let query = this.db
      .selectFrom('community_requests as request')
      .innerJoin('users as user', 'user.id', 'request.user_id')
      .where('request.kind', '!=', 'moderator_invitation')
      .select([
        'request.id',
        'request.user_id',
        'request.kind',
        'request.board',
        'request.state',
        'request.data',
        'request.version',
        'request.created_at',
        'user.nickname',
      ]);
    if (board)
      query = query.where('request.board', '=', board).where('request.kind', '=', 'assistant');
    else if (!admin) query = query.where('request.user_id', '=', actorId);
    const rows = await query.orderBy('request.created_at', 'desc').execute();
    const events = rows.length
      ? await this.db
          .selectFrom('community_request_events')
          .selectAll()
          .where(
            'request_id',
            'in',
            rows.map((row) => row.id),
          )
          .orderBy('created_at')
          .execute()
      : [];
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        data: JSON.parse(row.data) as ApplicationData,
        events: events.filter((event) => event.request_id === row.id),
        eligibility:
          admin || board ? await getApplicationEligibility(this.db, row.user_id) : undefined,
        dispositions: admin
          ? await this.db
              .selectFrom('admin_actions')
              .select(['id', 'action', 'reason', 'created_at'])
              .where('target', '=', row.user_id)
              .where('action', 'in', ['disposition', 'penalty', 'penalty.revoke', 'restriction'])
              .orderBy('created_at', 'desc')
              .limit(20)
              .execute()
          : undefined,
      })),
    );
  }

  async submit(
    actorId: string,
    input: {
      id: string;
      kind: 'board' | 'moderator' | 'assistant';
      board: string;
      data: ApplicationData;
    },
  ) {
    if (input.kind !== 'board' || input.data.applyModerator)
      throw new ForbiddenException('MANAGEMENT_INVITATION_REQUIRED');
    validateMaterials(input.kind, input.data);
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
      const existing = await tx
        .selectFrom('community_requests')
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirst();
      if (existing) {
        if (
          existing.user_id !== actorId ||
          existing.data !== JSON.stringify(input.data) ||
          existing.board !== input.board ||
          existing.kind !== input.kind
        )
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return existing;
      }
      await requireApplicationEligibility(tx, actorId);
      if (input.kind !== 'board') {
        await requireBoards(tx, [input.board]);
        const moderator = (await boardModerators(tx)).find((entry) => entry.board === input.board);
        if (input.kind === 'moderator' && moderator)
          throw new ConflictException('BOARD_MODERATOR_EXISTS');
        if (input.kind === 'assistant' && (!moderator || moderator.userId === actorId))
          throw new ConflictException('BOARD_MODERATOR_REQUIRED');
        const duplicate = await tx
          .selectFrom('community_requests')
          .select('id')
          .where('user_id', '=', actorId)
          .where('board', '=', input.board)
          .where('kind', '=', input.kind)
          .where('state', 'in', ['pending', 'returned'])
          .executeTakeFirst();
        if (duplicate) throw new ConflictException('APPLICATION_ALREADY_PENDING');
      }
      const row = {
        id: input.id,
        user_id: actorId,
        kind: input.kind,
        board: input.board,
        data: JSON.stringify(input.data),
        state: 'pending',
        version: 1,
        created_at: new Date(),
      };
      await tx.insertInto('community_requests').values(row).execute();
      await tx
        .insertInto('community_request_events')
        .values({
          id: randomUUID(),
          request_id: row.id,
          actor_id: actorId,
          action: 'submitted',
          reason: '',
          created_at: new Date(),
        })
        .execute();
      return row;
    });
  }

  async change(
    actorId: string,
    input: {
      id: string;
      version: number;
      action: 'approve' | 'return' | 'reject' | 'withdraw' | 'resubmit' | 'recommend';
      reason: string;
      data?: ApplicationData | undefined;
      permissions: ModerationPermission[];
      teamId?: string | undefined;
    },
  ) {
    return this.db.transaction().execute(async (tx) => {
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
      if (!row) throw new NotFoundException('APPLICATION_NOT_FOUND');
      if (row.kind !== 'board' && input.action !== 'withdraw')
        throw new ForbiddenException('MANAGEMENT_INVITATION_REQUIRED');
      if (input.action === 'resubmit' && input.data?.applyModerator)
        throw new ForbiddenException('MANAGEMENT_INVITATION_REQUIRED');
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ actorId, ...input }))
        .digest('hex');
      const completed = await tx
        .selectFrom('admin_actions')
        .select('after_data')
        .where('actor_id', '=', actorId)
        .where('request_hash', '=', requestHash)
        .executeTakeFirst();
      if (completed)
        return {
          state: JSON.parse(completed.after_data).state as string,
          version: input.version + 1,
        };
      if (row.version !== input.version)
        throw new ConflictException('APPLICATION_VERSION_CONFLICT');
      const personal = ['withdraw', 'resubmit'].includes(input.action);
      if (personal) {
        if (row.user_id !== actorId) throw new ForbiddenException('APPLICATION_NOT_YOURS');
      } else if (input.action === 'recommend') {
        if (row.kind !== 'moderator' || !input.reason.trim())
          throw new BadRequestException('RECOMMENDATION_REQUIRED');
        const access = await moderationAccess(tx, actorId);
        if (
          !access.admin &&
          !access.boards.some((entry) => entry.board === row.board && entry.role === 'moderator')
        )
          throw new ForbiddenException('MODERATOR_REQUIRED');
      } else if (row.kind === 'assistant') {
        const moderator = (await boardModerators(tx)).find((entry) => entry.board === row.board);
        if (!moderator || moderator.userId !== actorId)
          throw new ForbiddenException('BOARD_MODERATOR_REQUIRED');
      } else await requireScope(tx, actorId);
      if (
        input.action === 'resubmit'
          ? row.state !== 'returned'
          : !['pending', 'returned'].includes(row.state)
      )
        throw new ConflictException('APPLICATION_NOT_PENDING');
      const data: ApplicationData =
        input.action === 'resubmit' && input.data ? input.data : JSON.parse(row.data);
      if (input.action === 'resubmit' || input.action === 'approve')
        validateMaterials(row.kind, data);
      let state = row.state;
      if (input.action === 'approve') {
        await tx
          .selectFrom('users')
          .select('id')
          .where('id', '=', row.user_id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        await requireApplicationEligibility(tx, row.user_id);
        state = 'approved';
        if (row.kind === 'board') {
          const slug = communitySlug(row.board);
          const existing = await tx
            .selectFrom('communities')
            .select('id')
            .where('slug', '=', slug)
            .executeTakeFirst();
          if (existing) throw new ConflictException('BOARD_SLUG_EXISTS');
          const id = randomUUID();
          await tx
            .insertInto('communities')
            .values({ id, slug, name: data.name, description: data.description })
            .execute();
          await tx
            .insertInto('wiki_spaces')
            .values({ id: randomUUID(), community_id: id })
            .execute();
          const settings = await tx
            .selectFrom('runtime_settings')
            .selectAll()
            .where('id', '=', 'site-settings')
            .forUpdate()
            .executeTakeFirstOrThrow();
          const value = JSON.parse(settings.value);
          value.boards[row.board] = {
            description: data.description,
            rules: data.rules,
            prompt: '',
            posting: { readonly: false, firstPostReview: false, cooldownSeconds: 0 },
          };
          await tx
            .updateTable('runtime_settings')
            .set({
              value: JSON.stringify(value),
              revision: settings.revision + 1,
              updated_at: new Date(),
            })
            .where('id', '=', 'site-settings')
            .execute();
        } else if (row.kind === 'assistant') {
          const team = await tx
            .selectFrom('community_teams')
            .selectAll()
            .where('id', '=', input.teamId || '')
            .forUpdate()
            .executeTakeFirst();
          if (
            !team ||
            team.board !== row.board ||
            team.owner_id !== actorId ||
            team.state !== 'active'
          )
            throw new BadRequestException('SELECT_ACTIVE_OWN_TEAM');
          const access = await moderationAccess(tx, actorId);
          const grant = access.boards.find(
            (entry) => entry.board === row.board && entry.role === 'moderator',
          );
          const permissions = assistantPermissions(input.permissions);
          if (
            !grant ||
            !permits(grant.permissions, 'teams.manage') ||
            input.permissions.some((permission) => !permissions.includes(permission)) ||
            permissions.some((permission) => !permits(grant.permissions, permission))
          )
            throw new ForbiddenException('PERMISSION_ESCALATION');
          const member = await tx
            .selectFrom('community_team_members')
            .selectAll()
            .where('team_id', '=', team.id)
            .where('user_id', '=', row.user_id)
            .executeTakeFirst();
          if (member) throw new ConflictException('ALREADY_INVITED');
          await tx
            .insertInto('community_team_members')
            .values({
              team_id: team.id,
              user_id: row.user_id,
              state: 'active',
              permissions: JSON.stringify(permissions),
              version: 1,
            })
            .execute();
          await tx
            .updateTable('community_teams')
            .set({ version: team.version + 1 })
            .where('id', '=', team.id)
            .execute();
        } else {
          await requireBoards(tx, [row.board]);
          if (
            (await boardModerators(tx)).some(
              (entry) => entry.board === row.board && entry.userId !== row.user_id,
            )
          )
            throw new ConflictException('BOARD_MODERATOR_EXISTS');
          const member = await tx
            .selectFrom('moderation_group_members')
            .selectAll()
            .where('group_id', '=', moderatorGroupId)
            .where('user_id', '=', row.user_id)
            .executeTakeFirst();
          const boards = [
            ...new Set([...(member ? JSON.parse(member.boards ?? '[]') : []), row.board]),
          ];
          await tx
            .insertInto('moderation_group_members')
            .values({
              group_id: moderatorGroupId,
              user_id: row.user_id,
              boards: JSON.stringify(boards),
            })
            .onDuplicateKeyUpdate({ boards: JSON.stringify(boards) })
            .execute();
          await tx
            .insertInto('moderator_board_grants')
            .values({
              user_id: row.user_id,
              board: row.board,
              permissions: JSON.stringify(normalizePermissions(input.permissions)),
            })
            .onDuplicateKeyUpdate({
              permissions: JSON.stringify(normalizePermissions(input.permissions)),
            })
            .execute();
          await requireSingleBoardModerator(tx);
        }
      } else if (input.action === 'resubmit') {
        await requireApplicationEligibility(tx, row.user_id);
        const moderator = (await boardModerators(tx)).find((entry) => entry.board === row.board);
        if (row.kind === 'moderator' && moderator)
          throw new ConflictException('BOARD_MODERATOR_EXISTS');
        if (row.kind === 'assistant' && !moderator)
          throw new ConflictException('BOARD_MODERATOR_REQUIRED');
        state = 'pending';
      } else if (input.action === 'return') state = 'returned';
      else if (input.action === 'reject') state = 'rejected';
      else if (input.action === 'withdraw') state = 'withdrawn';
      await tx
        .updateTable('community_requests')
        .set({ state, data: JSON.stringify(data), version: row.version + 1 })
        .where('id', '=', row.id)
        .execute();
      await tx
        .insertInto('community_request_events')
        .values({
          id: randomUUID(),
          request_id: row.id,
          actor_id: actorId,
          action: input.action,
          reason: input.reason,
          created_at: new Date(),
        })
        .execute();
      if (!personal)
        await tx
          .insertInto('admin_notifications')
          .values({
            id: randomUUID(),
            user_id: row.user_id,
            text: '申请进度更新',
            detail: data.name + ' · ' + state + (input.reason ? ' · ' + input.reason : ''),
            href: '/#/my-applications',
            created_at: new Date(),
          })
          .execute();
      await tx
        .insertInto('admin_actions')
        .values({
          id: randomUUID(),
          actor_id: actorId,
          target: row.id,
          action: 'application.' + input.action,
          request_hash: requestHash,
          reason: input.reason,
          before_data: JSON.stringify(row),
          after_data: JSON.stringify({ state, data }),
          board: row.board,
          created_at: new Date(),
        })
        .execute();
      return { state, version: row.version + 1 };
    });
  }
}
