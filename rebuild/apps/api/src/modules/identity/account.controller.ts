import { Body, Controller, Get, Inject, Post, Req, BadRequestException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from './auth.controller.js';
import { AccountService } from './account.service.js';

type Request = { headers: { authorization?: string } };
function token(req: Request) {
  return req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
}
@Controller('/api/v1/account')
export class AccountController {
  private readonly service: AccountService;
  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.service = new AccountService(db);
  }
  @Get() overview(@Req() req: Request) {
    return this.service.overview(token(req));
  }
  @Post('profile') profile(@Req() req: Request, @Body() body: unknown) {
    return this.service.profile(token(req), body);
  }
  @Post('unlink') unlink(@Req() req: Request, @Body() body: unknown) {
    const input = z
      .strictObject({ key: z.string().regex(/^(wechat|[a-f0-9]{64})$/) })
      .safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    return this.service.unlink(token(req), input.data.key);
  }
  @Post('revoke') revoke(@Req() req: Request, @Body() body: unknown) {
    const input = z.strictObject({ id: z.union([z.uuid(), z.literal('others')]) }).safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    return this.service.revoke(token(req), input.data.id);
  }
  @Post('close') close(@Req() req: Request, @Body() body: unknown) {
    if (!z.strictObject({ confirmation: z.literal('注销我的账号') }).safeParse(body).success)
      throw new BadRequestException('INVALID_INPUT');
    return this.service.close(token(req));
  }
}
