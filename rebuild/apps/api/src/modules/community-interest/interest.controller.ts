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
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { ArtifactKind, ForecastFields } from '../../../../../packages/contracts/src/interest.js';
import { adminActor, audit, businessDay, context, parse, type InterestRequest } from './common.js';
import { PreferencesService } from './preferences.service.js';
import { PollsService } from './polls.service.js';
import { NewsService } from './news.service.js';
import { ForecastsService } from './forecasts.service.js';
import { ArtifactsService } from './artifacts.service.js';
import { providerStatus } from './forecast-provider.js';
import { sourceHosts } from './source-fetch.js';
import { moderationAccess } from '../admin/scope.js';

@Controller('/api/v1/interest')
export class InterestController {
  constructor(@Inject(DATABASE) readonly db: Kysely<Database>) {}
  @Get('preferences') async preferences(@Req() req: InterestRequest) {
    const ctx = await context(this.db, req);
    return new PreferencesService(this.db).get(ctx.actor?.userId || null);
  }
  @Put('preferences') async savePreferences(@Req() req: InterestRequest, @Body() body: unknown) {
    return new PreferencesService(this.db).save(await context(this.db, req, true), body);
  }
  @Post('dismiss/:id') async dismiss(@Req() req: InterestRequest, @Param('id') id: string) {
    return new PreferencesService(this.db).dismiss(await context(this.db, req, true), id);
  }
  @Get('recommendations') async recommendations(@Req() req: InterestRequest) {
    return new PreferencesService(this.db).recommendations(await context(this.db, req));
  }
  @Get('polls/:id') async poll(@Req() req: InterestRequest, @Param('id') id: string) {
    const ctx = await context(this.db, req);
    return { poll: await new PollsService(this.db).view(id, ctx.actor?.userId || null) };
  }
  @Post('polls') async createPoll(@Req() req: InterestRequest, @Body() body: unknown) {
    return new PollsService(this.db).create(await context(this.db, req, true), body);
  }
  @Put('polls/:id') async editPoll(
    @Req() req: InterestRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return new PollsService(this.db).edit(await context(this.db, req, true), id, body);
  }
  @Post('polls/:id/vote') async vote(
    @Req() req: InterestRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return new PollsService(this.db).vote(await context(this.db, req, true), id, body);
  }
  @Post('polls/:id/cancel') async cancel(@Req() req: InterestRequest, @Param('id') id: string) {
    return new PollsService(this.db).cancel(await context(this.db, req, true), id);
  }
  @Get('news') async news(
    @Req() req: InterestRequest,
    @Query()
    query: { cursor?: string; limit?: string; board?: string; saved?: string; followed?: string },
  ) {
    const ctx = await context(this.db, req, query.saved === 'true' || query.followed === 'true');
    return new NewsService(this.db).list(query, ctx.actor?.userId || null);
  }
  @Get('forecasts') async forecasts(
    @Req() req: InterestRequest,
    @Query()
    query: { cursor?: string; limit?: string; field?: string; saved?: string; followed?: string },
  ) {
    const ctx = await context(this.db, req, query.saved === 'true' || query.followed === 'true');
    return new ForecastsService(this.db).list(query, ctx.actor?.userId || null);
  }
  @Get('saved') async saved(@Req() req: InterestRequest) {
    return new ArtifactsService(this.db).saved(await context(this.db, req, true));
  }
  @Get('items/:kind/:id') async item(
    @Req() req: InterestRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    const ctx = await context(this.db, req);
    return new ArtifactsService(this.db).detail(
      parse(ArtifactKind, kind),
      id,
      ctx.actor?.userId || null,
    );
  }
  @Post('items/:kind/:id/comments') async comment(
    @Req() req: InterestRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return new ArtifactsService(this.db).comment(
      await context(this.db, req, true),
      parse(ArtifactKind, kind),
      id,
      body,
    );
  }
  @Post('items/:kind/:id/actions') async action(
    @Req() req: InterestRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return new ArtifactsService(this.db).action(
      await context(this.db, req, true),
      parse(ArtifactKind, kind),
      id,
      body,
    );
  }
  @Post('items/:kind/:id/reports') async report(
    @Req() req: InterestRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return new ArtifactsService(this.db).report(
      await context(this.db, req, true),
      parse(ArtifactKind, kind),
      id,
      body,
    );
  }
  @Get('admin') async admin(@Req() req: InterestRequest) {
    const ctx = await context(this.db, req, true);
    const access = await moderationAccess(this.db, ctx.actor!.userId);
    const reports = await new ArtifactsService(this.db).management(ctx);
    if (!access.admin)
      return {
        canConfigure: false,
        sources: [],
        templates: [],
        days: [],
        reports,
        runs: [],
        forecasts: [],
        provider: { ready: false, reason: '来源与模型由全站管理员维护' },
        allowedSourceHosts: [],
        fields: ForecastFields,
      };
    const [sources, templates, days, runs, forecasts] = await Promise.all([
      this.db.selectFrom('interest_sources').selectAll().orderBy('id').execute(),
      this.db.selectFrom('interest_forecast_templates').selectAll().orderBy('id').execute(),
      this.db
        .selectFrom('interest_forecast_days')
        .selectAll()
        .orderBy('business_day', 'desc')
        .limit(30)
        .execute(),
      this.db
        .selectFrom('interest_forecast_runs')
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(30)
        .execute(),
      this.db
        .selectFrom('interest_forecasts')
        .selectAll()
        .where('state', 'in', ['open', 'review'])
        .orderBy('deadline')
        .limit(50)
        .execute(),
    ]);
    return {
      canConfigure: true,
      sources,
      templates,
      days,
      reports,
      runs,
      forecasts: forecasts.map((r) => new ForecastsService(this.db).card(r)),
      provider: providerStatus(),
      allowedSourceHosts: [...sourceHosts()],
      fields: ForecastFields,
    };
  }
  @Post('admin/sources') async source(@Req() req: InterestRequest, @Body() body: unknown) {
    return new NewsService(this.db).saveSource(await context(this.db, req, true), body);
  }
  @Post('admin/templates') async template(@Req() req: InterestRequest, @Body() body: unknown) {
    return new ForecastsService(this.db).saveTemplate(await context(this.db, req, true), body);
  }
  @Post('admin/moderate') async moderate(@Req() req: InterestRequest, @Body() body: unknown) {
    return new ArtifactsService(this.db).moderate(await context(this.db, req, true), body);
  }
  @Post('admin/resolve/:id') async resolve(
    @Req() req: InterestRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return new ForecastsService(this.db).resolve(await context(this.db, req, true), id, body);
  }
  @Post('admin/retry') async retry(@Req() req: InterestRequest, @Body() body: unknown) {
    parse(z.strictObject({}), body);
    const actor = await adminActor(this.db, await context(this.db, req, true)),
      day = businessDay();
    const row = await this.db
      .selectFrom('interest_forecast_days')
      .select('state')
      .where('business_day', '=', day)
      .executeTakeFirst();
    if (row?.state !== 'paused') throw new BadRequestException('ONLY_PAUSED_DAY_CAN_RETRY');
    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('interest_forecast_days')
        .set({ state: 'pending', reason: '' })
        .where('business_day', '=', day)
        .where('state', '=', 'paused')
        .execute();
      await audit(
        tx,
        actor.userId,
        'interest.forecast.retry',
        day,
        '管理员请求在剩余免费配额内重试',
      );
    });
    return { ok: true };
  }
}
