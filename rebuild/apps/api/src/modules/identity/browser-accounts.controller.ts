import { Body, Controller, Get, Post, Req, Inject, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from './auth.controller.js';
import { BrowserAccountService } from './browser-accounts.service.js';
type Request = { headers: { authorization?: string; 'x-browser-key'?: string } };
const version = z.number().int().nonnegative();
function parse<T>(schema: z.ZodType<T>, body: unknown) {
  const p = schema.safeParse(body);
  if (!p.success) throw new BadRequestException('INVALID_INPUT');
  return p.data;
}
@Controller('/api/v1/auth/browser')
export class BrowserAccountsController {
  private readonly service: BrowserAccountService;
  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.service = new BrowserAccountService(db);
  }
  private key(req: Request) {
    return req.headers['x-browser-key'] ?? '';
  }
  private token(req: Request) {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : '';
  }
  @Get('accounts') list(@Req() req: Request) {
    return this.service.list(this.key(req), this.token(req));
  }
  @Get('context') context(@Req() req: Request) {
    return this.service.context(this.key(req), this.token(req));
  }
  @Post('remember') remember(@Req() req: Request, @Body() raw: unknown) {
    const b = parse(z.strictObject({ version: version.optional() }), raw);
    return this.service.remember(this.key(req), this.token(req), b.version);
  }
  @Post('switch') switch(@Req() req: Request, @Body() raw: unknown) {
    const b = parse(z.strictObject({ accountId: z.string().min(1).max(64), version }), raw);
    return this.service.switch(this.key(req), b.accountId, b.version);
  }
  @Post('remove') remove(@Req() req: Request, @Body() raw: unknown) {
    const b = parse(z.strictObject({ accountId: z.string().min(1).max(64), version }), raw);
    return this.service.remove(this.key(req), b.accountId, b.version);
  }
  @Post('logout-all') all(@Req() req: Request, @Body() raw: unknown) {
    const b = parse(z.strictObject({ version }), raw);
    return this.service.logoutAll(this.key(req), b.version);
  }
}
