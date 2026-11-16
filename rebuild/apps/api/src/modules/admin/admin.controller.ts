import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { DemoBoard } from '../demo/demo.schema.js';
import { moderationAccess, requireScope } from './scope.js';
import {
  listModerationGroups,
  saveModerationGroup,
  setModerationMembership,
  changeGroupMembers,
  deleteModerationGroup,
  transferSiteOwnership,
  assignModeratorBoards,
} from './groups.js';
import {
  AdminActionSchema,
  AdminQuerySchema,
  ModerationGroupInput,
  ModerationMembershipInput,
  GroupDeleteInput,
  GroupMembersInput,
  ModeratorMemberBoardsInput,
  OwnershipTransferInput,
  permits,
  type ModerationPermission,
} from '../../../../../packages/contracts/src/admin.js';
import { AdminService } from './admin.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { issueRegistrationInvite } from '../settings/registration-policy.js';
import { UpdateSiteSettingsSchema } from '../../../../../packages/contracts/src/site-settings.js';

type Request = { headers: { authorization?: string } };
function parseBoard(value?: string) {
  if (value === undefined) return undefined;
  const parsed = DemoBoard.safeParse(value);
  if (!parsed.success) throw new BadRequestException('INVALID_INPUT');
  return parsed.data;
}
@Controller('/api/v1/admin/community')
export class AdminController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    @Inject(AdminService) private readonly service: AdminService,
  ) {}
  private async actor(req: Request) {
    const header = req.headers.authorization;
    const actor = await new PasswordAuthService(this.db).authenticate(
      header?.startsWith('Bearer ') ? header.slice(7) : '',
    );
    return actor;
  }
  @Get('access') async access(@Req() req: Request) {
    return moderationAccess(this.db, (await this.actor(req)).userId);
  }
  @Get('site-settings') async siteSettings(@Req() req: Request) {
    await requireScope(this.db, (await this.actor(req)).userId);
    return new SettingsService(this.db).getSiteSettings();
  }
  @Post('site-settings') async saveSiteSettings(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    const input = UpdateSiteSettingsSchema.safeParse(body);
    if (!input.success)
      throw new BadRequestException({
        message: 'INVALID_SITE_SETTINGS',
        issues: input.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      });
    return new SettingsService(this.db).updateSiteSettings(actor.userId, input.data);
  }
  @Post('registration-invite') async registrationInvite(@Req() req: Request) {
    return issueRegistrationInvite(this.db, (await this.actor(req)).userId);
  }
  @Get('context') async context(
    @Req() req: Request,
    @Query('user') user: string,
    @Query('board') value?: string,
  ) {
    const actor = await this.actor(req);
    const board = parseBoard(value);
    await requireScope(this.db, actor.userId, board, 'history');
    return this.service.context(user, board);
  }
  @Get('overview') async overview(@Req() req: Request, @Query('board') value?: string) {
    const actor = await this.actor(req);
    const board = parseBoard(value);
    const access = await requireScope(this.db, actor.userId, board);
    const grants = access.boards.find((entry) => entry.board === board)?.permissions;
    const overview = await this.service.overview(board);
    if (!grants) return overview;
    return {
      pending: permits(grants, 'reports') ? overview.pending : 0,
      posts: permits(grants, 'content') ? overview.posts : 0,
      replies: permits(grants, 'content') ? overview.replies : 0,
      users: permits(grants, 'users') ? overview.users : 0,
      restricted: permits(grants, 'users') ? overview.restricted : 0,
      wiki: permits(grants, 'wiki') ? overview.wiki : 0,
    };
  }
  @Get('dispositions') async dispositions(
    @Req() req: Request,
    @Query('user') user: string,
    @Query('board') value?: string,
  ) {
    const board = parseBoard(value);
    await requireScope(this.db, (await this.actor(req)).userId, board, 'users.manage');
    let query = this.db
      .selectFrom('moderation_penalties')
      .select(['id', 'capability', 'board'])
      .where('user_id', '=', user)
      .where('revoked_at', 'is', null)
      .where('superseded_by', 'is', null)
      .where((eb) => eb.or([eb('until_at', 'is', null), eb('until_at', '>', new Date())]));
    if (board) query = query.where('board', '=', board);
    return query.execute();
  }
  @Get('items') async list(@Req() req: Request, @Query() query: unknown) {
    const { actor, input, access } = await this.listContext(req, query);
    return this.service.list(input, actor.userId, access);
  }
  @Get('bootstrap') async bootstrap(@Req() req: Request, @Query() query: unknown) {
    const { actor, input, access } = await this.listContext(req, query);
    return { userId: actor.userId, access, list: await this.service.list(input, actor.userId, access) };
  }
  private async listContext(req: Request, query: unknown) {
    const actor = await this.actor(req);
    const input = AdminQuerySchema.safeParse(query);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    const { section, board } = input.data;
    if (section === 'team') await requireScope(this.db, actor.userId);
    const access = await requireScope(
      this.db,
      actor.userId,
      board,
      section === 'team'
        ? undefined
        : section === 'appeals'
          ? 'appeals.view'
          : section === 'reviews' || section === 'trash'
            ? 'content'
            : (section as ModerationPermission),
    );
    if (
      section === 'team' &&
      board &&
      access.boards.find((entry) => entry.board === board)?.role === 'group'
    )
      throw new ForbiddenException('MODERATION_PERMISSION_REQUIRED');
    return { actor, input: input.data, access };
  }
  @Get('groups') async groups(@Req() req: Request, @Query('board') value?: string) {
    await requireScope(this.db, (await this.actor(req)).userId);
    return listModerationGroups(this.db, parseBoard(value));
  }
  @Post('groups') async saveGroup(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    const input = ModerationGroupInput.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    return saveModerationGroup(this.db, actor.userId, input.data);
  }
  @Post('membership') async membership(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    const input = ModerationMembershipInput.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    return setModerationMembership(this.db, actor.userId, input.data);
  }
  @Post('groups/delete') async deleteGroup(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    const input = GroupDeleteInput.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    return deleteModerationGroup(this.db, actor.userId, input.data.id);
  }
  @Post('groups/members') async changeMembers(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    const input = GroupMembersInput.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    return changeGroupMembers(this.db, actor.userId, input.data);
  }
  @Post('ownership/transfer') async transferOwnership(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    const input = OwnershipTransferInput.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    return transferSiteOwnership(this.db, actor.userId, input.data.userId);
  }
  @Post('groups/boards') async assignBoards(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    const input = ModeratorMemberBoardsInput.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    return assignModeratorBoards(this.db, actor.userId, input.data.userIds, input.data.boards);
  }
  @Post('actions') async act(
    @Req() req: Request,
    @Body() body: unknown,
    @Query('board') value?: string,
  ) {
    const actor = await this.actor(req);
    const input = AdminActionSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    const board = parseBoard(value);
    return this.service.act(actor.userId, input.data, board);
  }
}
