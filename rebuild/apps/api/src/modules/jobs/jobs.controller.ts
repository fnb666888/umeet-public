import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import {
  JobListQuerySchema,
  UpdateLimitsSchema,
  ReasonSchema,
  type RequestContext,
} from '../../../../../packages/contracts/src/index.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { requirePlatformAdmin } from '../identity/permissions.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { JobsService } from './jobs.service.js';
type AuthRequest = { headers: { authorization?: string | string[] } };
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException('INVALID_INPUT');
  return result.data;
}
@Controller('/api/v1/admin')
export class JobsController {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}
  private async context(req: AuthRequest): Promise<RequestContext> {
    const value = req.headers.authorization,
      token = typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : '';
    const actor = await new PasswordAuthService(this.db).authenticate(token),
      ctx = { actor, requestId: 'operations' };
    requirePlatformAdmin(ctx);
    return ctx;
  }
  @Get('jobs') async list(@Req() req: AuthRequest, @Query() query: unknown) {
    return new JobsService(this.db).list(await this.context(req), parse(JobListQuerySchema, query));
  }
  @Get('jobs/stats') async stats(@Req() req: AuthRequest) {
    return new JobsService(this.db).stats(await this.context(req));
  }
  @Post('jobs/:id/retry') async retry(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const ctx = await this.context(req),
      input = parse(z.strictObject({ reason: ReasonSchema }), body);
    await new JobsService(this.db).retryFailed(ctx, id, input.reason);
    return { ok: true };
  }
  @Get('settings/limits') async limits(@Req() req: AuthRequest) {
    await this.context(req);
    return new SettingsService(this.db).getLimits();
  }
  @Put('settings/limits') async update(@Req() req: AuthRequest, @Body() body: unknown) {
    const ctx = await this.context(req);
    return new SettingsService(this.db).updateLimits(ctx, parse(UpdateLimitsSchema, body));
  }
}
