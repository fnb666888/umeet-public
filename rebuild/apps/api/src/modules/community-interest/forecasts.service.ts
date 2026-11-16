import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import {
  ForecastFields,
  ForecastOutput,
  ResolutionInput,
  TemplateInput,
  type Evidence,
  type ForecastCard,
} from '../../../../../packages/contracts/src/interest.js';
import { requireBoards } from '../communities/board-directory.js';
import { adminActor, audit, businessDay, pageQuery, parse, type InterestDb } from './common.js';
import { fetchSource, plainSource, type SourceFetcher } from './source-fetch.js';
import { freeProvider, providerStatus, type ForecastProvider } from './forecast-provider.js';
import type { InterestTables } from './interest.tables.js';

import { notifyFollowers } from './notifications.js';

export class ForecastsService {
  constructor(
    readonly db: InterestDb,
    readonly fetcher: SourceFetcher = fetchSource,
    readonly provider: ForecastProvider = freeProvider(),
  ) {}
  card(row: InterestTables['interest_forecasts']): ForecastCard {
    return {
      id: row.id,
      title: row.title,
      field: row.field,
      probability: row.probability,
      reasoning: row.reasoning,
      counterEvidence: row.counter_evidence,
      evidence: JSON.parse(row.evidence),
      informationAt: row.information_at.toISOString(),
      deadline: row.deadline.toISOString(),
      rules: row.rules,
      createdAt: row.created_at.toISOString(),
      state: row.state,
      outcome: row.outcome,
      resolution: row.resolution,
      resultEvidence: JSON.parse(row.result_evidence),
      brier:
        row.state === 'resolved' && row.outcome !== null
          ? (row.probability - row.outcome) ** 2
          : null,
    };
  }
  async list(
    query: { cursor?: unknown; limit?: unknown; field?: string; saved?: string; followed?: string },
    userId: string | null = null,
  ) {
    const hidden = this.db
      .selectFrom('admin_visibility')
      .select(sql<string>`SUBSTRING(target, 10)`.as('id'))
      .where('target', 'like', 'forecast:%')
      .where('hidden', '=', 1);
    const page = pageQuery(query.cursor, query.limit);
    let q = this.db
      .selectFrom('interest_forecasts')
      .selectAll()
      .where('state', '!=', 'hidden')
      .where('id', 'not in', hidden);
    if (query.field) q = q.where('field', '=', query.field);
    for (const kind of ['save', 'follow'] as const)
      if ((kind === 'save' ? query.saved : query.followed) === 'true')
        q = q.where(
          'id',
          'in',
          this.db
            .selectFrom('interest_actions')
            .select('target_id')
            .where('target_type', '=', 'forecast')
            .where('kind', '=', kind)
            .where('user_id', '=', userId || ''),
        );
    if (page.at)
      q = q.where((eb) =>
        eb.or([
          eb('created_at', '<', page.at!),
          eb.and([eb('created_at', '=', page.at!), eb('id', '<', page.id)]),
        ]),
      );
    const rows = await q
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.limit + 1)
      .execute();
    const items = rows.slice(0, page.limit),
      last = items.at(-1);
    const today = await this.db
      .selectFrom('interest_forecast_days')
      .select(['state', 'reason', 'business_day'])
      .where('business_day', '=', businessDay())
      .executeTakeFirst();
    const templates = await this.db
      .selectFrom('interest_forecast_templates')
      .innerJoin('interest_sources', 'interest_sources.id', 'interest_forecast_templates.source_id')
      .select([
        'field',
        'interest_forecast_templates.enabled',
        'interest_sources.approved',
        'interest_sources.enabled as source_enabled',
      ])
      .execute();
    const resolved = await this.db
      .selectFrom('interest_forecasts')
      .select(['probability', 'outcome'])
      .where('state', '=', 'resolved')
      .where('outcome', 'is not', null)
      .execute();
    return {
      items: items.map((r) => this.card(r)),
      next: rows.length > page.limit && last ? last.created_at.toISOString() + '|' + last.id : null,
      today: today || {
        state: 'pending',
        reason: '每天北京时间 08:00 运行；无可用来源或模型时暂停',
        business_day: businessDay(),
      },
      fields: ForecastFields.map((field) => ({
        field,
        ready: templates.some(
          (t) => t.field === field && t.enabled && t.approved && t.source_enabled,
        ),
        reason: templates.some(
          (t) => t.field === field && t.enabled && t.approved && t.source_enabled,
        )
          ? '已配置题型与来源'
          : '暂无已确认可用的题型及免费来源',
      })),
      score: {
        resolved: resolved.length,
        brier: resolved.length
          ? resolved.reduce((sum, r) => sum + (r.probability - r.outcome!) ** 2, 0) /
            resolved.length
          : null,
      },
    };
  }
  async get(id: string) {
    const row = await this.db
      .selectFrom('interest_forecasts')
      .selectAll()
      .where('id', '=', id)
      .where('state', '!=', 'hidden')
      .executeTakeFirst();
    const hidden = await this.db
      .selectFrom('admin_visibility')
      .select('hidden')
      .where('target', '=', 'forecast:' + id)
      .executeTakeFirst();
    if (!row || hidden?.hidden) throw new NotFoundException('FORECAST_NOT_FOUND');
    return this.card(row);
  }
  async saveTemplate(ctx: RequestContext, input: unknown) {
    const actor = await adminActor(this.db, ctx),
      data = parse(TemplateInput, input);
    await requireBoards(this.db, [data.board]);
    const source = await this.db
      .selectFrom('interest_sources')
      .selectAll()
      .where('id', '=', data.sourceId)
      .executeTakeFirst();
    if (!source || source.kind !== 'github' || data.field !== 'technology')
      throw new BadRequestException('SUPPORTED_OFFICIAL_RELEASE_SOURCE_REQUIRED');
    await this.db.transaction().execute(async (tx) => {
      const value = {
        id: data.id,
        name: data.name,
        field: data.field,
        board: data.board,
        source_id: data.sourceId,
        target: data.target,
        days_ahead: data.daysAhead,
        enabled: Number(data.enabled),
      };
      await tx
        .insertInto('interest_forecast_templates')
        .values(value)
        .onDuplicateKeyUpdate(value)
        .execute();
      await audit(tx, actor.userId, 'interest.template.save', data.id, '官方正式版本发布题型配置');
    });
    return { ok: true };
  }
  async pause(day: string, reason: string) {
    await this.db
      .updateTable('interest_forecast_days')
      .set({ state: 'paused', reason, updated_at: new Date() })
      .where('business_day', '=', day)
      .where('state', '!=', 'published')
      .execute();
  }
  async generate(now = new Date(), options: { providerReady?: boolean; dailyCalls?: number } = {}) {
    const day = businessDay(now);
    if (new Date(now.getTime() + 8 * 3600000).getUTCHours() < 8) return { state: 'not-due' };
    const claimed = await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('interest_forecast_days')
        .values({
          business_day: day,
          state: 'pending',
          reason: '',
          created_at: now,
          updated_at: now,
        })
        .onDuplicateKeyUpdate({ business_day: day })
        .execute();
      const slot = await tx
        .selectFrom('interest_forecast_days')
        .selectAll()
        .where('business_day', '=', day)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (
        slot.state !== 'pending' &&
        !(slot.state === 'running' && slot.updated_at.getTime() < now.getTime() - 15 * 60000)
      )
        return false;
      await tx
        .updateTable('interest_forecast_days')
        .set({ state: 'running', updated_at: now })
        .where('business_day', '=', day)
        .execute();
      return true;
    });
    if (!claimed) return { state: 'already-claimed' };
    const runId = randomUUID();
    await this.db
      .insertInto('interest_forecast_runs')
      .values({ id: runId, business_day: day, state: 'running', data: '{}', created_at: now })
      .execute();
    try {
      if (!(options.providerReady ?? providerStatus().ready))
        throw new Error('免费预测模型未配置或尚未确认正式使用条件');
      const usedRuns = await this.db
        .selectFrom('interest_forecast_runs')
        .select('data')
        .where('state', '=', 'published')
        .execute();
      const used = usedRuns
        .map(
          (r) =>
            JSON.parse(r.data).resolver as
              { sourceId: string; sourceUrl: string; target: string } | undefined,
        )
        .filter(Boolean);
      let q = this.db
        .selectFrom('interest_forecast_templates')
        .innerJoin(
          'interest_sources',
          'interest_sources.id',
          'interest_forecast_templates.source_id',
        )
        .selectAll('interest_forecast_templates')
        .select(['interest_sources.url as source_url', 'interest_sources.name as source_name'])
        .where('interest_forecast_templates.enabled', '=', 1)
        .where('interest_sources.enabled', '=', 1)
        .where('interest_sources.approved', '=', 1);
      const templates = await q.orderBy('interest_forecast_templates.id').execute();
      let template: (typeof templates)[number] | undefined;
      let releases: Record<string, unknown>[] = [];
      for (const candidate of templates
        .filter((t) => !used.some((u) => u!.sourceUrl === t.source_url && u!.target === t.target))
        .slice(0, 10)) {
        try {
          const response = await this.fetcher(candidate.source_url);
          if (!Array.isArray(response.value)) continue;
          const records = response.value.filter(
            (v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v),
          );
          if (
            records.some(
              (r) => r['tag_name'] === candidate.target && !r['draft'] && !r['prerelease'],
            )
          ) {
            await this.db.transaction().execute(async (tx) => {
              await tx
                .updateTable('interest_forecast_templates')
                .set({ enabled: 0 })
                .where('id', '=', candidate.id)
                .where('target', '=', candidate.target)
                .where('source_id', '=', candidate.source_id)
                .execute();
              await audit(
                tx,
                'system',
                'interest.template.expired',
                candidate.id,
                '目标版本已正式发布，自动停用旧题型',
              );
            });
            continue;
          }
          if (
            !records.some(
              (r) =>
                !r['draft'] &&
                !r['prerelease'] &&
                Number.isFinite(new Date(String(r['published_at'] || '')).getTime()) &&
                new Date(String(r['published_at'])) <= now &&
                String(r['html_url'] || '').startsWith('https://github.com/'),
            )
          )
            continue;
          template = candidate;
          releases = records;
          break;
        } catch {
          continue;
        }
      }
      if (!template)
        throw new Error('暂无新的合格题目；本轮最多检查 10 个候选，请核验来源和题型状态');
      const evidence: Evidence[] = releases
        .filter((r) => !r['draft'] && !r['prerelease'])
        .slice(0, 8)
        .flatMap((r, i) => {
          const date = new Date(String(r['published_at'] || ''));
          if (!Number.isFinite(date.getTime()) || date > now) return [];
          const url = String(r['html_url'] || '');
          if (!/^https:\/\/github\.com\//.test(url)) return [];
          return [
            {
              id: 'e' + i,
              title: plainSource(r['name'] || r['tag_name'], 200),
              url,
              excerpt: '官方正式版本记录；发布时间 ' + date.toISOString(),
              fetchedAt: now.toISOString(),
            },
          ];
        });
      if (!evidence.length) throw new Error('没有足够的可引用官方版本记录');
      const deadline = new Date(
        new Date(day + 'T15:59:59.999Z').getTime() + template.days_ahead * 86400000,
      );
      const title = `${template.name}：${template.target} 是否会在北京时间 ${businessDay(deadline)} 23:59 前正式发布？`;
      const rules =
        '以配置的官方 GitHub 仓库正式 release 为准；tag 必须精确等于 ' +
        template.target +
        '，不包括 draft 或 prerelease，published_at 必须晚于信息截止时刻且不晚于截止时刻。未发现记录不自动认定为否，转人工复核。';
      const maxCalls = Math.max(
        0,
        Math.min(10, options.dailyCalls ?? Number(process.env.INTEREST_AI_DAILY_CALLS || 2)),
      );
      if (!Number.isInteger(maxCalls)) throw new Error('AI 调用配额配置无效');
      await this.db.transaction().execute(async (tx) => {
        await tx
          .insertInto('interest_usage')
          .values({ business_day: day, count: 0 })
          .onDuplicateKeyUpdate({ business_day: day })
          .execute();
        const quota = await tx
          .selectFrom('interest_usage')
          .select('count')
          .where('business_day', '=', day)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (quota.count >= maxCalls) throw new Error('当日免费 AI 调用配额已用尽');
        await tx
          .updateTable('interest_usage')
          .set({ count: sql`count + 1` })
          .where('business_day', '=', day)
          .execute();
      });
      const output = parse(
        ForecastOutput,
        await this.provider({ question: title, rules, informationAt: now.toISOString(), evidence }),
      );
      if (output.evidenceIds.some((id) => !evidence.some((e) => e.id === id)))
        throw new Error('模型返回了未提供的证据编号');
      const id = randomUUID();
      await this.db.transaction().execute(async (tx) => {
        const slot = await tx
          .selectFrom('interest_forecast_days')
          .selectAll()
          .where('business_day', '=', day)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (slot.state !== 'running') throw new ConflictException('FORECAST_SLOT_CHANGED');
        await tx
          .insertInto('interest_forecasts')
          .values({
            id,
            business_day: day,
            template_id: template.id,
            field: template.field,
            board: template.board,
            title,
            probability: output.probability,
            reasoning: output.reasoning,
            counter_evidence: output.counterEvidence,
            evidence: JSON.stringify(evidence),
            information_at: now,
            deadline,
            rules,
            created_at: new Date(),
            state: 'open',
            outcome: null,
            resolution: '',
            result_evidence: '[]',
          })
          .execute();
        await tx
          .updateTable('interest_forecast_days')
          .set({ state: 'published', reason: '', updated_at: new Date() })
          .where('business_day', '=', day)
          .execute();
        await tx
          .updateTable('interest_forecast_runs')
          .set({
            state: 'published',
            data: JSON.stringify({
              forecastId: id,
              model: process.env.INTEREST_AI_MODEL || 'test-provider',
              resolver: {
                sourceId: template.source_id,
                sourceUrl: template.source_url,
                target: template.target,
              },
            }),
          })
          .where('id', '=', runId)
          .execute();
      });
      return { state: 'published', id };
    } catch (error) {
      const known =
        error instanceof Error && /^[\u4e00-\u9fff]/.test(error.message)
          ? error.message
          : '来源或免费模型暂不可用，已暂停；详情见任务记录';
      await this.pause(day, known);
      await this.db
        .updateTable('interest_forecast_runs')
        .set({ state: 'paused', data: JSON.stringify({ reason: known }) })
        .where('id', '=', runId)
        .execute();
      return { state: 'paused', reason: known };
    }
  }
  async resolve(ctx: RequestContext, id: string, input: unknown) {
    const actor = await adminActor(this.db, ctx),
      data = parse(ResolutionInput, input);
    await this.db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom('interest_forecasts')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (row.state !== 'open' && row.state !== 'review')
        throw new ConflictException('FORECAST_ALREADY_RESOLVED');
      if (data.state === 'resolved' && row.deadline > new Date())
        throw new ConflictException('FORECAST_NOT_DUE');
      const evidence = data.evidence.map((e, i) => ({
        id: 'result-' + i,
        title: e.title,
        url: e.url,
        excerpt: '人工核验',
        fetchedAt: new Date().toISOString(),
      }));
      await tx
        .updateTable('interest_forecasts')
        .set({
          state: data.state,
          outcome: data.outcome,
          resolution: data.reason,
          result_evidence: JSON.stringify(evidence),
        })
        .where('id', '=', id)
        .execute();
      await audit(tx, actor.userId, 'interest.forecast.resolve', id, data.reason);
      await notifyFollowers(tx, 'forecast', id, 'resolution:' + id, '你关注的预测已有核验结果');
    });
    return this.get(id);
  }
  async autoResolve(now = new Date()) {
    const rows = await this.db
      .selectFrom('interest_forecasts')
      .selectAll()
      .where('state', '=', 'open')
      .where('deadline', '<=', now)
      .limit(10)
      .execute();
    for (const row of rows) {
      try {
        const run = await this.db
          .selectFrom('interest_forecast_runs')
          .select('data')
          .where('business_day', '=', row.business_day)
          .where('state', '=', 'published')
          .executeTakeFirstOrThrow();
        const frozen = JSON.parse(run.data).resolver as
          { sourceId: string; sourceUrl: string; target: string } | undefined;
        if (!frozen) throw new Error('缺少发布时的来源快照');
        const source = await this.db
          .selectFrom('interest_sources')
          .selectAll()
          .where('id', '=', frozen.sourceId)
          .executeTakeFirst();
        if (!source?.enabled || !source.approved || source.url !== frozen.sourceUrl)
          throw new Error('原始来源已停用或变更');
        const data = await this.fetcher(frozen.sourceUrl);
        if (!Array.isArray(data.value)) throw new Error('来源格式不可用');
        const release = data.value.find(
          (v) =>
            v &&
            typeof v === 'object' &&
            (v as Record<string, unknown>)['tag_name'] === frozen.target &&
            !(v as Record<string, unknown>)['draft'] &&
            !(v as Record<string, unknown>)['prerelease'],
        ) as Record<string, unknown> | undefined;
        if (!release) throw new Error('未发现目标版本记录，无法从记录缺失直接认定未发生');
        const published = new Date(String(release['published_at'] || ''));
        const url = String(release['html_url'] || '');
        if (
          !Number.isFinite(published.getTime()) ||
          !url.startsWith('https://github.com/') ||
          published <= row.information_at
        )
          throw new Error('官方记录时间或身份需要复核');
        const outcome = published <= row.deadline ? 1 : 0;
        await this.db.transaction().execute(async (tx) => {
          const current = await tx
            .selectFrom('interest_forecasts')
            .select('state')
            .where('id', '=', row.id)
            .forUpdate()
            .executeTakeFirstOrThrow();
          if (current.state !== 'open') return;
          await tx
            .updateTable('interest_forecasts')
            .set({
              state: 'resolved',
              outcome,
              resolution: '依据目标正式版本的官方 published_at 自动核验。',
              result_evidence: JSON.stringify([
                {
                  id: 'official-result',
                  title: frozen.target,
                  url,
                  excerpt: '官方发布时间 ' + published.toISOString(),
                  fetchedAt: now.toISOString(),
                },
              ]),
            })
            .where('id', '=', row.id)
            .execute();
          await audit(
            tx,
            'system',
            'interest.forecast.auto-resolve',
            row.id,
            '官方正式版本时间核验',
          );
          await notifyFollowers(
            tx,
            'forecast',
            row.id,
            'resolution:' + row.id,
            '你关注的预测已有核验结果',
          );
        });
      } catch {
        await this.db
          .updateTable('interest_forecasts')
          .set({ state: 'review', resolution: '官方结果缺失、来源异常或时间含糊，等待人工核验。' })
          .where('id', '=', row.id)
          .where('state', '=', 'open')
          .execute();
      }
    }
  }
}
