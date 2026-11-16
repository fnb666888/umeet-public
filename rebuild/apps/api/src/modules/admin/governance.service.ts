import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type { AdminItem, GovernanceStatus } from '../../../../../packages/contracts/src/admin.js';
import type { ReportSchema } from '../../../../../packages/contracts/src/admin.js';
import { reportReasonApplies } from '../../../../../packages/contracts/src/report-reasons.js';
import { dispositionEffects } from './dispositions.js';
import { SettingsService } from '../settings/settings.service.js';
import type { z } from 'zod';
import type { DemoPost, DemoWiki } from '../demo/demo.schema.js';

export type StoredReport = {
  userId: string;
  target: string;
  reason: string;
  categoryLabel?: string;
  detail?: string;
  createdAt: number;
  evidence: AdminItem;
  escalated?: boolean;
};

export class GovernanceService {
  constructor(private readonly db: Kysely<Database>) {}

  async report(userId: string, input: z.infer<typeof ReportSchema>) {
    return this.db.transaction().execute(async (tx) => {
      // The shared content lock serializes report deduplication with content edits and adjudication.
      await tx
        .selectFrom('demo_content')
        .select('id')
        .where('id', '=', 'global')
        .forUpdate()
        .executeTakeFirstOrThrow();
      return new GovernanceService(tx).record(userId, input);
    });
  }

  async record(userId: string, input: z.infer<typeof ReportSchema>) {
    const existing = await this.db
      .selectFrom('demo_entities')
      .selectAll()
      .where('kind', '=', 'report')
      .execute();
    const results = new Set(
      (await this.db.selectFrom('admin_report_results').select('report_id').execute()).map(
        (row) => row.report_id,
      ),
    );
    const own = existing.filter((row) => JSON.parse(row.data).userId === userId);
    const duplicate = own.find((row) => {
      const report = JSON.parse(row.data);
      return (report.target || 'post:' + report.postId) === input.target && !results.has(row.id);
    });
    if (duplicate) return { id: duplicate.id, reused: true };
    const dayStart = new Date(Date.now() + 8 * 3600000);
    dayStart.setUTCHours(0, 0, 0, 0);
    const cutoff = dayStart.getTime() - 8 * 3600000;
    if (own.filter((row) => JSON.parse(row.data).createdAt >= cutoff).length >= 20)
      throw new ForbiddenException('REPORT_DAILY_LIMIT');
    const evidence = await this.evidence(userId, input.target);
    const { settings } = await new SettingsService(this.db).getSiteSettings();
    const reason = settings.reportReasons.find(
      (item) => item.id === input.category && reportReasonApplies(item, evidence.boards || []),
    );
    if (!reason) throw new BadRequestException('REPORT_REASON_UNAVAILABLE');
    const id = 'report:' + randomUUID();
    const report: StoredReport = {
      userId,
      target: input.target,
      reason: reason.label + (input.detail ? ' · ' + input.detail : ''),
      categoryLabel: reason.label,
      detail: input.detail,
      createdAt: Date.now(),
      evidence,
    };
    await this.db
      .insertInto('demo_entities')
      .values({ id, kind: 'report', data: JSON.stringify(report) })
      .execute();
    return { id, reused: false };
  }

  private async evidence(reporterId: string, target: string): Promise<AdminItem> {
    const base: AdminItem = {
      id: target,
      target,
      kind: '',
      title: '',
      body: '',
      author: '',
      authorId: '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      href: '',
    };
    if (target.startsWith('profile:') || target.startsWith('account:')) {
      const id = target.slice(target.indexOf(':') + 1);
      const user = await this.db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!user) throw new NotFoundException('USER_NOT_FOUND');
      const state = await this.db
        .selectFrom('demo_user_states')
        .select('data')
        .where('user_id', '=', id)
        .executeTakeFirst();
      const profile = state ? JSON.parse(state.data) : {};
      const isProfile = target.startsWith('profile:');
      if (isProfile && profile.privacyPrefs?.profilePublic === false)
        throw new NotFoundException('PROFILE_PRIVATE');
      return {
        ...base,
        kind: isProfile ? 'profile' : 'account',
        title: user.nickname,
        body: isProfile ? profile.profile?.bio || '' : '账号行为举报',
        author: user.nickname,
        authorId: id,
        images: isProfile && profile.profile?.avatar ? [profile.profile.avatar] : [],
        href: '/#/users/' + id,
      };
    }
    if (target.startsWith('message:')) {
      const message = await this.db
        .selectFrom('demo_messages')
        .selectAll()
        .where('id', '=', target.slice(8))
        .where('recipient_id', '=', reporterId)
        .executeTakeFirst();
      if (!message) throw new NotFoundException('MESSAGE_NOT_FOUND');
      const sender = await this.db
        .selectFrom('users')
        .select('nickname')
        .where('id', '=', message.sender_id)
        .executeTakeFirst();
      return {
        ...base,
        kind: 'message',
        title: '私信举报',
        body: message.text,
        publishedAt: message.created_at.toISOString(),
        authorId: message.sender_id,
        author: sender?.nickname || '已注销用户',
      };
    }
    const wikiMatch = /^wiki:([^:]+)(?::([0-9]+))?$/.exec(target);
    const entityId = wikiMatch ? 'wiki:' + wikiMatch[1] : target;
    const row = await this.db
      .selectFrom('demo_entities')
      .selectAll()
      .where('id', '=', entityId)
      .executeTakeFirst();
    if (!row || !['post', 'reply', 'wiki'].includes(row.kind))
      throw new NotFoundException('CONTENT_NOT_FOUND');
    const value = JSON.parse(row.data);
    if (row.kind === 'wiki') {
      const wiki = value as DemoWiki;
      const revision = wikiMatch?.[2] ? Number(wikiMatch[2]) : wiki.revisions;
      const entry = wiki.history[wiki.revisions - revision];
      if (revision < 1 || revision > wiki.revisions || wiki.hiddenRevisions?.includes(revision))
        throw new NotFoundException('WIKI_REVISION_NOT_FOUND');
      const version = wikiMatch?.[2] ? entry?.['after'] || wiki : wiki;
      const source = version as DemoWiki;
      const draft = {
        title: source.title,
        summary: source.summary,
        sections: source.sections,
        quick: source.quick,
        table: source.table,
        reference: source.reference,
      };
      const safe = draft as DemoWiki;
      return {
        ...base,
        kind: 'wiki',
        title: safe.title,
        body: JSON.stringify(draft),
        ...(typeof entry?.['at'] === 'string'
          ? { publishedAt: entry['at'] }
          : revision === wiki.revisions && wiki.updatedAt
            ? { publishedAt: wiki.updatedAt }
            : {}),
        authorId: String(entry?.['authorId'] || wiki.editorId || ''),
        author: String(entry?.['author'] || wiki.editor),
        boards: wiki.communities,
        href: '/#/wiki/' + wiki.id,
      };
    }
    const hidden = await this.db
      .selectFrom('admin_visibility')
      .select('hidden')
      .where('target', '=', target)
      .executeTakeFirst();
    if (hidden?.hidden) throw new NotFoundException('CONTENT_NOT_FOUND');
    let board = value.community;
    if (row.kind === 'reply') {
      const post = await this.db
        .selectFrom('demo_entities')
        .select('data')
        .where('id', '=', 'post:' + value.postId)
        .executeTakeFirst();
      const postHidden = await this.db
        .selectFrom('admin_visibility')
        .select('hidden')
        .where('target', '=', 'post:' + value.postId)
        .executeTakeFirst();
      if (!post || postHidden?.hidden) throw new NotFoundException('CONTENT_NOT_FOUND');
      board = (JSON.parse(post.data) as DemoPost).community;
    }
    return {
      ...base,
      kind: row.kind,
      title: value.title || '回复',
      body: value.body,
      publishedAt: new Date(value.createdAt).toISOString(),
      authorId: value.authorId,
      author: value.author,
      images: value.images || (value.image ? [value.image] : []),
      boards: [board],
      href: '/#/posts/' + (value.postId || value.id),
    };
  }

  async status(userId: string): Promise<GovernanceStatus> {
    const [reports, results, notifications, actions, appeals, penalties] = await Promise.all([
      this.db.selectFrom('demo_entities').selectAll().where('kind', '=', 'report').execute(),
      this.db.selectFrom('admin_report_results').selectAll().execute(),
      this.db.selectFrom('admin_notifications').selectAll().where('user_id', '=', userId).execute(),
      this.db
        .selectFrom('admin_actions')
        .selectAll()
        .where('action', '!=', 'note')
        .orderBy('created_at', 'desc')
        .execute(),
      this.db.selectFrom('moderation_appeals').selectAll().where('user_id', '=', userId).execute(),
      this.db
        .selectFrom('moderation_penalties')
        .selectAll()
        .where('user_id', '=', userId)
        .execute(),
    ]);
    const effects = await dispositionEffects(this.db);
    return {
      suspended: penalties.some(
        (p) =>
          ['suspension', 'deactivation'].includes(p.capability) &&
          !p.revoked_at &&
          !p.superseded_by &&
          !p.board &&
          (!p.until_at || p.until_at > new Date()),
      ),
      reports: reports
        .flatMap((row) => {
          const report = JSON.parse(row.data) as StoredReport;
          if (report.userId !== userId) return [];
          const result = results.find((item) => item.report_id === row.id);
          return [
            {
              id: row.id,
              title: report.evidence?.title || '帖子举报',
              reason: result?.reason || report.reason,
              createdAt: new Date(report.createdAt).toISOString(),
              status: result?.outcome || (report.escalated ? 'escalated' : 'pending'),
            },
          ];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100),
      actions: actions
        .filter(
          (row) =>
            [
              'disposition',
              'penalty',
              'restriction',
              'visibility',
              'content.label',
              'case.resolve',
            ].includes(row.action) &&
            notifications.some((n) => n.id === row.id + ':' + userId) &&
            (row.target === userId ||
              (['visibility', 'content.label', 'case.resolve'].includes(row.action) &&
                noticeTargetsAuthor(
                  row.action,
                  row.before_data,
                  userId,
                  notifications.find((n) => n.id === row.id + ':' + userId)?.text || '',
                ))),
        )
        .slice(0, 100)
        .map((row) => {
          const notice = notifications.find((n) => n.id === row.id + ':' + userId)!;
          const appeal = appeals.find((a) => a.action_id === row.id);
          const penalty = penalties.find((p) => p.id === row.id);
          return {
            id: row.id,
            effects: effects.filter((effect) => effect.actionId === row.id),
            actionId: row.id,
            title: notice.text,
            reason: row.reason,
            createdAt: row.created_at.toISOString(),
            status: penalty
              ? penalty.revoked_at
                ? 'revoked'
                : penalty.superseded_by
                  ? 'superseded'
                  : penalty.capability === 'warning'
                    ? 'recorded'
                    : penalty.until_at && penalty.until_at <= new Date()
                      ? 'expired'
                      : 'active'
              : 'recorded',
            until: penalty?.until_at?.toISOString() || null,
            ...(appeal ? { appeal: { status: appeal.status, resolution: appeal.resolution } } : {}),
          };
        }),
    };
  }

  async appeal(userId: string, actionId: string, reason: string) {
    return this.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('demo_content')
        .select('id')
        .where('id', '=', 'global')
        .forUpdate()
        .executeTakeFirstOrThrow();
      const own = await new GovernanceService(tx).status(userId);
      if (!own.actions.some((row) => row.actionId === actionId))
        throw new ForbiddenException('APPEAL_PERMISSION_REQUIRED');
      const old = await tx
        .selectFrom('moderation_appeals')
        .selectAll()
        .where('action_id', '=', actionId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (old) {
        if (old.user_id === userId) return { id: old.id };
        throw new ConflictException('APPEAL_ALREADY_SUBMITTED');
      }
      const id = randomUUID();
      await tx
        .insertInto('moderation_appeals')
        .values({
          id,
          user_id: userId,
          action_id: actionId,
          reason,
          status: 'pending',
          resolution: '',
          created_at: new Date(),
        })
        .execute();
      return { id };
    });
  }
}

function noticeTargetsAuthor(action: string, before: string, userId: string, text: string) {
  if (action === 'case.resolve')
    return (JSON.parse(before) as AdminItem[]).some((item) => item.authorId === userId);
  return text.startsWith('你的内容') || text.startsWith('管理人员要求');
}
