import {
  Controller,
  Post,
  Body,
  Req,
  Inject,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from './auth.controller.js';
import { AUTH_CONFIGURATION, type AuthConfiguration } from './auth-configuration.js';
import { WechatMiniAdapter } from './wechat-mini.adapter.js';
import { PasswordAuthService } from './password-auth.service.js';
type AuthRequest = { headers: { authorization?: string | string[] }; ip?: string };
@Controller('/api/v1/auth/wechat')
export class WechatAuthController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    @Inject(AUTH_CONFIGURATION) private readonly config: AuthConfiguration,
  ) {}
  @Post('mini') async mini(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = z.strictObject({ code: z.string().min(1).max(512) }).safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    if (!this.config.wechatMini) throw new ServiceUnavailableException('LOGIN_CHANNEL_UNAVAILABLE');
    const auth = new PasswordAuthService(this.db, '微信小程序');
    await auth.consumeExternalAttempt(req.ip || 'unknown');
    const header = req.headers.authorization,
      token =
        typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    const actor = await auth.optionalActor(token);
    const proof = await new WechatMiniAdapter(this.config.wechatMini).verify(input.data.code);
    return auth.acceptExternalProof(proof, actor?.kind === 'guest' ? token : undefined);
  }
  @Post('link') async link(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = z.strictObject({ code: z.string().min(1).max(512) }).safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    if (!this.config.wechatMini) throw new ServiceUnavailableException('LOGIN_CHANNEL_UNAVAILABLE');
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    const auth = new PasswordAuthService(this.db);
    await auth.consumeExternalAttempt(req.ip || 'unknown');
    await auth.requireRecentMember(token);
    const proof = await new WechatMiniAdapter(this.config.wechatMini).verify(input.data.code);
    return auth.withVerifiedLink(async () => ({ proof }), token);
  }
}
