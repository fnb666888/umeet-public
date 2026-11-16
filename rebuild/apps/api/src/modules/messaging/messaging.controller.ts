import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { requireMember } from '../identity/permissions.service.js';
import { DemoId } from '../../../../../packages/contracts/src/community.js';
import {
  SendMessage,
  ConversationAction,
} from '../../../../../packages/contracts/src/messaging.js';
import { MessagingService } from './messaging.service.js';
type Request = { headers: { authorization?: string } };
@Controller('/api/v1/messages')
export class MessagingController {
  private readonly auth: PasswordAuthService;
  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(MessagingService) private readonly messages: MessagingService,
  ) {
    this.auth = new PasswordAuthService(db);
  }
  private async user(req: Request) {
    const header = req.headers.authorization;
    return requireMember({
      actor: await this.auth.optionalActor(
        header?.startsWith('Bearer ') ? header.slice(7) : undefined,
      ),
      requestId: 'messages',
    }).userId;
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new BadRequestException('INVALID_INPUT');
    return result.data;
  }
  @Get() async list(@Req() req: Request, @Query() query: unknown) {
    const input = this.parse(
      z.object({
        view: z.enum(['messages', 'requests', 'unread']).default('messages'),
        cursor: DemoId.optional(),
      }),
      query,
    );
    return this.messages.list(await this.user(req), input.view, input.cursor);
  }
  @Get('users') async users(@Req() req: Request, @Query('q') q: unknown) {
    return this.messages.search(await this.user(req), this.parse(z.string().max(32), q || ''));
  }
  @Post('preferences') async preferences(@Req() req: Request, @Body() body: unknown) {
    const input = this.parse(z.object({ allowRequests: z.boolean() }), body);
    return this.messages.preferences(await this.user(req), input.allowRequests);
  }
  @Get(':peer') async history(
    @Req() req: Request,
    @Param('peer') peer: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
  ) {
    return this.messages.history(
      await this.user(req),
      this.parse(DemoId, peer),
      this.parse(DemoId.optional(), before),
      this.parse(DemoId.optional(), after),
    );
  }
  @Post(':peer/send') async send(
    @Req() req: Request,
    @Param('peer') peer: string,
    @Body() body: unknown,
  ) {
    return this.messages.send(
      await this.user(req),
      this.parse(DemoId, peer),
      this.parse(SendMessage, body),
    );
  }
  @Post(':peer/action') async action(
    @Req() req: Request,
    @Param('peer') peer: string,
    @Body() body: unknown,
  ) {
    return this.messages.action(
      await this.user(req),
      this.parse(DemoId, peer),
      this.parse(ConversationAction, body),
    );
  }
}
