import { Body, Controller, Inject, Post, Req, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { UsernameSchema } from '../../../../../packages/contracts/src/index.js';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { OtpRequestSchema, OtpVerifySchema } from '../../../../../packages/contracts/src/index.js';
import { DATABASE } from './auth.controller.js';
import { AUTH_CONFIGURATION, type AuthConfiguration } from './auth-configuration.js';
import { OTP_SENDERS, type OtpSenders } from './otp-sender.js';
import { OtpService } from './otp.service.js';
import { PasswordAuthService } from './password-auth.service.js';
import { InviteCode } from '../../../../../packages/contracts/src/site-settings.js';
import { verifyTurnstile } from './turnstile.js';
type AuthRequest = {
  headers: { authorization?: string | string[]; 'user-agent'?: string };
  ip?: string;
};
function bearer(req: AuthRequest): string {
  const value = req.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : '';
}
@Controller('/api/v1/auth/otp')
export class OtpController {
  private readonly otp: OtpService;
  private readonly auth: PasswordAuthService;
  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(AUTH_CONFIGURATION) config: AuthConfiguration,
    @Inject(OTP_SENDERS) senders: OtpSenders,
  ) {
    this.otp = new OtpService(db, config.otp?.policy || null, senders);
    this.auth = new PasswordAuthService(db);
  }
  @Post('request') async request(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = OtpRequestSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    await this.auth.consumeOtpRequest(req.ip || 'unknown');
    await verifyTurnstile((body as Record<string,unknown>).turnstileToken);
    return this.otp.request(
      input.data.channel,
      input.data.recipient,
      input.data.purpose,
      bearer(req),
    );
  }
  @Post('login') async login(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = OtpVerifySchema.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    await this.auth.consumeExternalAttempt(req.ip || 'unknown');
    const token = bearer(req),
      actor = await this.auth.optionalActor(token, true);
    return this.otp.verifyLogin(
      input.data,
      actor?.kind === 'guest' ? token : undefined,
      req.headers['user-agent'],
    );
  }
  @Post('link') async link(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = OtpVerifySchema.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    await this.auth.consumeExternalAttempt(req.ip || 'unknown');
    return this.otp.verifyLink(input.data, bearer(req));
  }
  @Post('reauth') async reauth(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = OtpVerifySchema.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    await this.auth.consumeExternalAttempt(req.ip || 'unknown');
    return this.otp.verifyReauthentication(input.data, bearer(req));
  }
  @Post('register') async register(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = OtpVerifySchema.extend({
      username: UsernameSchema,
      password: z.string().min(12).max(128),
      inviteCode: InviteCode.optional(),
    }).safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    await this.auth.consumeExternalAttempt(req.ip || 'unknown');
    const token = bearer(req),
      actor = await this.auth.optionalActor(token);
    return this.otp.register(
      input.data,
      actor?.kind === 'guest' ? token : undefined,
      req.headers['user-agent'],
    );
  }
  @Post('password-check') async checkPassword(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = OtpVerifySchema.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    await this.auth.consumeExternalAttempt(req.ip || 'unknown');
    return this.otp.checkPasswordChallenge(input.data, bearer(req));
  }
  @Post('password') async password(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = OtpVerifySchema.extend({
      password: z.string().min(12).max(128),
      currentPassword: z.string().min(1).max(128).optional(),
    }).safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    await this.auth.consumeExternalAttempt(req.ip || 'unknown');
    return this.otp.changePassword(input.data, bearer(req), req.headers['user-agent']);
  }
  @Post('recovery') async recovery(@Body() body: unknown, @Req() req: AuthRequest) {
    const input = OtpVerifySchema.extend({ password: z.string().min(12).max(128) }).safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    await this.auth.consumeExternalAttempt(req.ip || 'unknown');
    return this.otp.resetPassword(input.data, req.headers['user-agent']);
  }
}
