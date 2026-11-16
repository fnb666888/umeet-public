import type { Kysely } from 'kysely';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../database/database.types.js';
import {
  LimitsSchema,
  UpdateLimitsSchema,
  type LimitsSnapshot,
  type RequestContext,
} from '../../../../../packages/contracts/src/index.js';
import { requirePlatformAdmin } from '../identity/permissions.service.js';
import { AuditService } from '../audit/audit.service.js';
import { requireScope } from '../admin/scope.js';
import { requireCapability } from '../admin/restrictions.js';
import {
  SiteSettingsSchema,
  type PublicSiteSettings,
  type SiteSettingsSnapshot,
} from '../../../../../packages/contracts/src/site-settings.js';
import { defaultSiteSettings } from '../../../../../packages/contracts/src/site-settings-defaults.js';
import { boardSlug } from '../../../../../packages/contracts/src/boards.js';
export class SettingsService {
  constructor(readonly db: Kysely<Database>) {}
  async getSiteSettings(): Promise<SiteSettingsSnapshot> {
    const row = await this.db
      .selectFrom('runtime_settings')
      .select(['revision', 'value'])
      .where('id', '=', 'site-settings')
      .executeTakeFirst();
    const snapshot = row
      ? { revision: row.revision, settings: SiteSettingsSchema.parse(JSON.parse(row.value)) }
      : { revision: 0, settings: structuredClone(defaultSiteSettings) };
    for (const board of await this.db
      .selectFrom('communities')
      .select(['slug', 'name'])
      .execute()) {
      const slug = boardSlug(board.slug);
      if (!snapshot.settings.boards[slug])
        snapshot.settings.boards[slug] = {
          description: board.name + '社区',
          rules: [],
          prompt: '',
          posting: { readonly: false, firstPostReview: false, cooldownSeconds: 0 },
        };
    }
    return snapshot;
  }

  async getPublicSiteSettings(): Promise<PublicSiteSettings> {
    const { settings } = await this.getSiteSettings();
    const now = Date.now();
    const scheduled = settings.announcements.filter((item) => item.enabled);
    const changes = scheduled
      .flatMap((item) => [item.startsAt, item.endsAt])
      .map((date) => (date ? Date.parse(date) : 0))
      .filter((date) => date > now);
    return {
      ...settings,
      registration: { mode: settings.registration.mode },
      reportReasons: settings.reportReasons.filter((reason) => reason.enabled),
      announcements: scheduled.filter(
        (item) =>
          (!item.startsAt || Date.parse(item.startsAt) <= now) &&
          (!item.endsAt || Date.parse(item.endsAt) > now),
      ),
      refreshAfterMs: changes.length ? Math.min(...changes) - now : null,
    };
  }

  async updateSiteSettings(
    actorId: string,
    input: SiteSettingsSnapshot,
  ): Promise<SiteSettingsSnapshot> {
    return this.db.transaction().execute(async (tx) => {
      await requireScope(tx, actorId);
      await requireCapability(tx, actorId, 'suspension');
      const row = await tx
        .selectFrom('runtime_settings')
        .selectAll()
        .where('id', '=', 'site-settings')
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (row.revision !== input.revision) throw new ConflictException('SETTINGS_VERSION_CONFLICT');
      const value = JSON.stringify(input.settings);
      if (value === row.value) return input;
      const revision = row.revision + 1;
      const changed = (Object.keys(input.settings) as (keyof typeof input.settings)[]).filter(
        (key) => JSON.stringify(JSON.parse(row.value)[key]) !== JSON.stringify(input.settings[key]),
      );
      const labels = {
        site: '站点信息',
        boards: '板块规则',
        announcements: '公告',
        reportReasons: '举报理由',
        registration: '注册准入',
        notifications: '通知默认值',
      };
      const now = new Date();
      await tx
        .updateTable('runtime_settings')
        .set({ revision, value, updated_at: now })
        .where('id', '=', row.id)
        .execute();
      await tx
        .insertInto('admin_actions')
        .values({
          id: randomUUID(),
          actor_id: actorId,
          action: 'settings.site',
          target: row.id,
          request_hash: '',
          reason: '更新' + changed.map((key) => labels[key]).join('、'),
          before_data: row.value,
          after_data: value,
          created_at: now,
        })
        .execute();
      return { revision, settings: input.settings };
    });
  }
  async getLimits(): Promise<LimitsSnapshot> {
    const row = await this.db
      .selectFrom('runtime_settings')
      .selectAll()
      .where('id', '=', 'upload-limits')
      .executeTakeFirstOrThrow();
    return { revision: row.revision, limits: LimitsSchema.parse(JSON.parse(row.value)) };
  }
  async updateLimits(ctx: RequestContext, input: unknown): Promise<LimitsSnapshot> {
    const actor = requirePlatformAdmin(ctx),
      data = UpdateLimitsSchema.parse(input);
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom('runtime_settings')
        .selectAll()
        .where('id', '=', 'upload-limits')
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (row.revision !== data.baseRevision)
        throw new ConflictException('SETTINGS_VERSION_CONFLICT');
      const revision = row.revision + 1;
      await tx
        .updateTable('runtime_settings')
        .set({ revision, value: JSON.stringify(data.limits), updated_at: new Date() })
        .where('id', '=', row.id)
        .execute();
      await new AuditService().append(tx, {
        actorId: actor.userId,
        kind: 'settings.limits-updated',
        targetId: row.id,
        reason: data.reason,
      });
      return { revision, limits: data.limits };
    });
  }
}
