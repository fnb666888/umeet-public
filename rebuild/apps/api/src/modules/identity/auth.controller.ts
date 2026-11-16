import { Body, Controller, Get, Post, Req, Inject, BadRequestException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import { PasswordAuthService } from './password-auth.service.js';
import { LoginSchema } from '../../../../../packages/contracts/src/index.js';
import { AUTH_CONFIGURATION, type AuthConfiguration } from './auth-configuration.js';
export const DATABASE = Symbol.for('umeet.database');
type AuthRequest = {
  headers: { authorization?: string | string[]; 'user-agent'?: string };
  ip?: string;
};
function bearer(req: AuthRequest): string {
  const header = req.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException('INVALID_INPUT');
  return result.data;
}
@Controller('/api/v1/auth')
export class AuthController {
  private readonly auth: PasswordAuthService;
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    @Inject(AUTH_CONFIGURATION) private readonly config: AuthConfiguration,
  ) {
    this.auth = new PasswordAuthService(db);
  }
  @Post('guest') guest(@Body() body: unknown, @Req() req: AuthRequest) {
    parse(z.strictObject({}), body ?? {});
    return this.auth.guest(req.ip || 'unknown');
  }
  @Post('register') register(@Body() body: unknown, @Req() req: AuthRequest) {
    throw new BadRequestException('EMAIL_REGISTRATION_REQUIRED');
  }
  @Post('login') async login(@Body() body: unknown, @Req() req: AuthRequest) {
    const data = parse(LoginSchema, body);
    const token = bearer(req);
    const actor = await this.auth.optionalActor(token, true);
    return new PasswordAuthService(this.db, req.headers['user-agent']).login(
      { ...data, ...(actor?.kind === 'guest' ? { guestToken: token } : {}) },
      req.ip || 'unknown',
    );
  }
  @Post('logout') async logout(@Req() req: AuthRequest) {
    await this.auth.logout(bearer(req));
    return { ok: true };
  }
  @Get('me') async me(@Req() req: AuthRequest) {
    const actor = await this.auth.authenticate(bearer(req));
    const user = await this.db
      .selectFrom('users')
      .select('nickname')
      .where('id', '=', actor.userId)
      .executeTakeFirst();
    return { ...actor, nickname: user?.nickname ?? actor.userId };
  }
  @Get('methods') methods(@Req() req: AuthRequest) {
    return this.auth.listMethods(bearer(req));
  }
  @Post('password') password() {
    throw new BadRequestException('EMAIL_VERIFICATION_REQUIRED');
  }
  @Get('channels') channels() {
    return {
      guest: true,
      password: true,
      wechatMini: !!this.config.wechatMini,
      wechatWeb: false,
      email: !!this.config.otp?.email,
      sms: !!this.config.otp?.sms,
    };
  }
  @Post('reauth') reauth(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = parse(z.strictObject({ password: z.string().min(1).max(128) }), body);
    return this.auth.reauthenticate(bearer(req), input.password, req.ip || 'unknown');
  }
}
