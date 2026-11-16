import { randomUUID } from 'node:crypto';
import { SettingsService } from '../settings/settings.service.js';
import { communitySlug } from '../../../../../packages/contracts/src/boards.js';
import {
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseFilters,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { CommunityTeamsService } from '../admin/community-teams.js';
import { ApplicationsService } from './applications.service.js';
import { getApplicationEligibility } from './application-policy.js';
import { moderationPermissions } from '../../../../../packages/contracts/src/admin.js';
import { baseModerationAccess, requireScope } from '../admin/scope.js';
import { requireCapability } from '../admin/restrictions.js';
import { listBoards } from './board-directory.js';
import { respondModeratorInvitation, withdrawModeratorInvitation } from '../admin/moderator-invitations.js';

const permissionList = z.array(z.enum(moderationPermissions));
@Catch(z.ZodError)
class GovernanceValidationFilter implements ExceptionFilter {
  catch(error: z.ZodError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse()
      .status(400)
      .json({ message: '请检查填写内容', issues: error.issues });
  }
}
const applicationData = z.strictObject({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(160),
  rules: z.array(z.string().trim().min(1).max(120)).max(6),
  reason: z.string().trim().min(1).max(2000),
  plan: z.string().max(2000),
  experience: z.string().max(2000),
  applyModerator: z.boolean(),
  moderatorReason: z.string().trim().max(2000).optional(),
});
const board = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/);
type Request = { headers: { authorization?: string } };

@UseFilters(GovernanceValidationFilter)
@Controller('/api/v1/community-governance')
export class ApplicationsController {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}
  @Get('boards') boards() {
    return listBoards(this.db);
  }
  private async actor(req: Request) {
    const actor = await new PasswordAuthService(this.db).authenticate(
      req.headers.authorization?.replace(/^Bearer /, '') ?? '',
    );
    await requireCapability(this.db, actor.userId, 'suspension');
    return actor.userId;
  }
  @Get('eligibility') async eligibility(@Req() req: Request) {
    return getApplicationEligibility(this.db, await this.actor(req));
  }
  @Get('applications') async list(
    @Req() req: Request,
    @Query('admin') admin?: string,
    @Query('board') board?: string,
  ) {
    return new ApplicationsService(this.db).list(await this.actor(req), admin === '1', board);
  }
  @Post('applications') async submit(@Req() req: Request, @Body() body: unknown) {
    const data = z
      .strictObject({
        id: z.uuid(),
        kind: z.enum(['board', 'moderator', 'assistant']),
        board,
        data: applicationData,
      })
      .parse(body);
    return new ApplicationsService(this.db).submit(await this.actor(req), data);
  }
  @Post('applications/change') async change(@Req() req: Request, @Body() body: unknown) {
    const data = z
      .strictObject({
        id: z.uuid(),
        version: z.number().int().positive(),
        action: z.enum(['approve', 'return', 'reject', 'withdraw', 'resubmit', 'recommend']),
        reason: z.string().trim().max(2000),
        data: applicationData.optional(),
        permissions: permissionList.default([]),
        teamId: z.uuid().optional(),
      })
      .parse(body);
    return new ApplicationsService(this.db).change(await this.actor(req), data);
  }
  @Get('teams') async teams(@Req() req: Request, @Query('board') value?: string) {
    return new CommunityTeamsService(this.db).list(await this.actor(req), value);
  }
  @Get('teams/mine') async mine(@Req() req: Request) {
    return new CommunityTeamsService(this.db).mine(await this.actor(req));
  }
  @Get('moderator-invitations') async moderatorInvitations(@Req() req: Request) {
    return this.db.selectFrom('community_requests').selectAll()
      .where('kind', '=', 'moderator_invitation').where('user_id', '=', await this.actor(req))
      .orderBy('created_at', 'desc').execute();
  }
  @Post('moderator-invitations/respond') async respondModerator(@Req() req: Request, @Body() body: unknown) {
    const input = z.strictObject({ id: z.uuid(), version: z.number().int().positive(), action: z.enum(['accept', 'decline']) }).parse(body);
    return respondModeratorInvitation(this.db, await this.actor(req), input);
  }
  @Post('moderator-invitations/withdraw') async withdrawModerator(@Req() req: Request, @Body() body: unknown) {
    const input = z.strictObject({ id: z.uuid() }).parse(body);
    return withdrawModeratorInvitation(this.db, await this.actor(req), input.id);
  }
  @Post('teams') async createTeam(@Req() req: Request, @Body() body: unknown) {
    return new CommunityTeamsService(this.db).create(
      await this.actor(req),
      z.strictObject({ id: z.uuid(), board, name: z.string().trim().min(1).max(40) }).parse(body),
    );
  }
  @Post('teams/change') async changeTeam(@Req() req: Request, @Body() body: unknown) {
    const data = z
      .strictObject({
        teamId: z.uuid(),
        version: z.number().int().positive(),
        action: z.enum(['invite', 'permissions', 'remove', 'approve-exit', 'transfer']),
        userId: z.string().min(1).max(64),
        permissions: permissionList.default([]),
      })
      .parse(body);
    return new CommunityTeamsService(this.db).manage(await this.actor(req), data);
  }
  @Post('teams/respond') async respond(@Req() req: Request, @Body() body: unknown) {
    return new CommunityTeamsService(this.db).respond(
      await this.actor(req),
      z
        .strictObject({
          teamId: z.uuid(),
          version: z.number().int().positive(),
          action: z.enum(['accept', 'decline', 'request-exit']),
        })
        .parse(body),
    );
  }
  @Get('users') async users(@Req() req: Request, @Query('board') value: string) {
    await requireScope(this.db, await this.actor(req), value, 'teams.manage');
    return this.db
      .selectFrom('users')
      .select(['id', 'nickname', 'handle'])
      .where('kind', '=', 'member')
      .where('deleted_at', 'is', null)
      .orderBy('nickname')
      .execute();
  }
  @Get('team-owners') async teamOwners(@Req() req: Request, @Query('board') value: string) {
    await requireScope(this.db, await this.actor(req));
    const users = await this.db
      .selectFrom('users')
      .select(['id', 'nickname', 'handle'])
      .where('kind', '=', 'member')
      .where('deleted_at', 'is', null)
      .orderBy('nickname')
      .execute();
    const qualified = await Promise.all(
      users.map(async (user) => {
        const access = await baseModerationAccess(this.db, user.id);
        return access.boards.some(
          (entry) =>
            entry.board === value &&
            entry.role === 'moderator' &&
            entry.permissions?.includes('teams.manage'),
        )
          ? user
          : null;
      }),
    );
    return qualified.filter((user) => user !== null);
  }
  @Get('board-settings') async boardSettings(@Req() req: Request, @Query('board') value: string) {
    await requireScope(this.db, await this.actor(req), value, 'boards.edit');
    const snapshot = await new SettingsService(this.db).getSiteSettings();
    return { version: snapshot.revision, ...snapshot.settings.boards[value] };
  }
  @Post('board-settings') async saveBoardSettings(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    const input = z
      .strictObject({
        board,
        version: z.number().int().min(0),
        description: z.string().trim().min(1).max(160),
        rules: z.array(z.string().trim().min(1).max(120)).max(6),
      })
      .parse(body);
    return this.db.transaction().execute(async (tx) => {
      const access = await requireScope(tx, actor, input.board, 'boards.edit');
      if (
        !access.admin &&
        !access.boards.some((entry) => entry.board === input.board && entry.role === 'moderator')
      )
        throw new ForbiddenException('MODERATOR_REQUIRED');
      const row = await tx
        .selectFrom('runtime_settings')
        .selectAll()
        .where('id', '=', 'site-settings')
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (row.revision !== input.version) throw new ConflictException('SETTINGS_VERSION_CONFLICT');
      const value = JSON.parse(row.value);
      const before = value.boards[input.board];
      value.boards[input.board] = { ...before, description: input.description, rules: input.rules };
      await tx
        .updateTable('runtime_settings')
        .set({ value: JSON.stringify(value), revision: row.revision + 1, updated_at: new Date() })
        .where('id', '=', row.id)
        .execute();
      await tx
        .updateTable('communities')
        .set({ description: input.description })
        .where('slug', '=', communitySlug(input.board))
        .execute();
      await tx
        .insertInto('admin_actions')
        .values({
          id: randomUUID(),
          actor_id: actor,
          target: input.board,
          board: input.board,
          action: 'board.update',
          request_hash: '',
          reason: '更新板块简介和规则',
          before_data: JSON.stringify(before),
          after_data: JSON.stringify(value.boards[input.board]),
          created_at: new Date(),
        })
        .execute();
      return { version: row.revision + 1, ...value.boards[input.board] };
    });
  }
  @Get('policy') async policy(@Req() req: Request) {
    await requireScope(this.db, await this.actor(req));
    const row = await this.db
      .selectFrom('runtime_settings')
      .selectAll()
      .where('id', '=', 'community-application-policy')
      .executeTakeFirst();
    return row
      ? { ...JSON.parse(row.value), version: row.revision }
      : { days: 30, posts: 5, version: 0 };
  }
  @Post('policy') async savePolicy(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    await requireScope(this.db, actor);
    const input = z
      .strictObject({
        days: z.number().int().min(0).max(3650),
        posts: z.number().int().min(0).max(10000),
        version: z.number().int().min(0),
      })
      .parse(body);
    return this.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', actor)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const row = await tx
        .selectFrom('runtime_settings')
        .selectAll()
        .where('id', '=', 'community-application-policy')
        .forUpdate()
        .executeTakeFirst();
      if ((row?.revision ?? 0) !== input.version)
        throw new ConflictException('SETTINGS_VERSION_CONFLICT');
      const value = JSON.stringify({ days: input.days, posts: input.posts });
      await tx
        .insertInto('runtime_settings')
        .values({
          id: 'community-application-policy',
          revision: input.version + 1,
          value,
          updated_at: new Date(),
        })
        .onDuplicateKeyUpdate({ value, revision: input.version + 1, updated_at: new Date() })
        .execute();
      await tx
        .insertInto('admin_actions')
        .values({
          id: randomUUID(),
          actor_id: actor,
          target: 'community-application-policy',
          action: 'settings.application-policy',
          request_hash: '',
          reason: '调整申请资格门槛',
          before_data: row?.value || '{}',
          after_data: value,
          created_at: new Date(),
        })
        .execute();
      return { ...input, version: input.version + 1 };
    });
  }
}
