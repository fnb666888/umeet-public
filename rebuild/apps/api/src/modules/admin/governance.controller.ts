import { BadRequestException, Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { AppealSchema, ReportSchema } from '../../../../../packages/contracts/src/admin.js';
import { GovernanceService } from './governance.service.js';
import { requireCapability } from './restrictions.js';

@Controller('/api/v1/governance')
export class GovernanceController {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}
  private async actor(req: { headers: { authorization?: string } }) {
    const actor = await new PasswordAuthService(this.db).authenticate(
      req.headers.authorization?.replace(/^Bearer /, '') || '',
      true,
    );
    if (actor.kind !== 'member') throw new BadRequestException('REGISTERED_ACCOUNT_REQUIRED');
    return actor;
  }
  @Get() async status(@Req() req: { headers: { authorization?: string } }) {
    return new GovernanceService(this.db).status((await this.actor(req)).userId);
  }
  @Post('reports') async report(
    @Req() req: { headers: { authorization?: string } },
    @Body() body: unknown,
  ) {
    const actor = await this.actor(req);
    const input = ReportSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    await requireCapability(this.db, actor.userId, 'suspension');
    return new GovernanceService(this.db).report(actor.userId, input.data);
  }
  @Post('appeals') async appeal(
    @Req() req: { headers: { authorization?: string } },
    @Body() body: unknown,
  ) {
    const actor = await this.actor(req);
    const input = AppealSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    return new GovernanceService(this.db).appeal(
      actor.userId,
      input.data.actionId,
      input.data.reason,
    );
  }
}
