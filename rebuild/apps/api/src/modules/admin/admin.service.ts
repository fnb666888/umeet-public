import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  boardCommunities,
  hasModerationPermission,
  moderationAccess,
  requireScope,
  requireAccountManagement,
  protectedPlatformAccounts,
} from './scope.js';
import { CommunitiesService } from '../communities/communities.service.js';
import {
  applyDisposition,
  revokeDisposition,
  dispositionEffects,
  recordContentEffect,
} from './dispositions.js';
import { businessAction } from './business-actions.js';
import type { StoredReport } from './governance.service.js';
import { requireCapability } from './restrictions.js';
import { publicWiki } from './wiki-visibility.js';
import { moderatorGroupId } from '../../../../../packages/contracts/src/admin.js';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { WikiDraft, type DemoPost, type DemoReply, type DemoWiki } from '../demo/demo.schema.js';
import { storeDemoAssets } from '../demo/demo-assets.js';
import type {
  AdminAction,
  AdminItem,
  AdminList,
  AdminQuery,
  ModerationPermission,
} from '../../../../../packages/contracts/src/admin.js';

const actionPermissions: Partial<Record<AdminAction['action'], ModerationPermission>> = {
  disposition: 'users.manage',
  penalty: 'users',
  'penalty.revoke': 'users',
  restriction: 'users',
  note: 'history',
  'case.escalate': 'reports',
  'case.resolve': 'reports',
  report: 'reports',
  visibility: 'content',
  'content.label': 'content',
  'post.settings': 'content',
  'post.review': 'content',
  'wiki.manage': 'wiki',
  'wiki.restore': 'wiki',
  'wiki.protect': 'wiki',
};

@Injectable()
export class AdminService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  private async data(db: Kysely<Database> = this.db, board?: string, includeAllPeople = false, purpose?: AdminQuery['section']) {
    const peopleOnly = purpose === 'users' && !board;
    let penaltyQuery = db.selectFrom('moderation_penalties').selectAll()
      .where('capability', '!=', 'warning').where('revoked_at', 'is', null).where('superseded_by', 'is', null)
      .where((eb) => eb.or([eb('until_at', 'is', null), eb('until_at', '>', new Date())]));
    if (board) penaltyQuery = penaltyQuery.where('board', '=', board);
    const [entities, users, visibility, restrictions, results, reports, messages, penalties, localRestrictions] =
      await Promise.all([
        peopleOnly ? Promise.resolve([]) : db
          .selectFrom('demo_entities')
          .selectAll()
          .where('kind', 'in', ['post', 'reply', 'wiki', 'report'])
          .execute(),
        db
          .selectFrom('users')
          .select(['id', 'nickname', 'handle', 'created_at', 'deleted_at'])
          .where('kind', '=', 'member')
          .execute(),
        peopleOnly ? [] : db.selectFrom('admin_visibility').selectAll().execute(),
        db.selectFrom('admin_restrictions').selectAll().execute(),
        peopleOnly ? [] : db.selectFrom('admin_report_results').selectAll().execute(),
        board || peopleOnly ? Promise.resolve([]) : db.selectFrom('dm_reports').selectAll().execute(),
        // Community moderators never load private message reports.
        board || peopleOnly
          ? Promise.resolve([])
          : db
              .selectFrom('demo_messages')
              .selectAll()
              .where('id', 'in', db.selectFrom('dm_reports').select('message_id'))
              .execute(),
        penaltyQuery.execute(),
        board ? db.selectFrom('community_restrictions').selectAll().where('board', '=', board).execute() : [],
      ]);
    const names = new Map(
      users.map((user) => [user.id, user.deleted_at ? '已注销用户' : user.nickname]),
    );
    const hidden = new Set(visibility.filter((row) => row.hidden).map((row) => row.target));
    const postBoards = new Map(
      entities
        .filter((row) => row.kind === 'post')
        .map((row) => {
          const post = JSON.parse(row.data) as DemoPost;
          return [post.id, post.community];
        }),
    );
    const content: AdminItem[] = [];
    const wiki: AdminItem[] = [];
    const flags: AdminItem[] = [];
    for (const row of entities) {
      const value = JSON.parse(row.data);
      if (row.kind === 'post' || row.kind === 'reply') {
        const item = value as DemoPost & DemoReply & { postId?: string };
        content.push({
          id: row.id,
          kind: row.kind,
          title: row.kind === 'post' ? item.title : '回复',
          body: item.body,
          author: names.get(item.authorId) || item.author,
          authorId: item.authorId,
          status: hidden.has(row.id) ? 'hidden' : 'visible',
          createdAt: new Date(item.createdAt).toISOString(),
          target: row.id,
          href: '/#/posts/' + (item.postId || item.id),
          images: item.images || (item.image ? [item.image] : []),
          boards: [item.community || postBoards.get(item.postId || '')].filter(
            (board): board is DemoPost['community'] => Boolean(board),
          ),
          pinned: Boolean((value as { pinned?: boolean }).pinned),
          locked: Boolean((value as { locked?: boolean }).locked),
          archived: Boolean(value.archived),
          labels: value.moderationLabels || {},
        });
      }
      if (row.kind === 'wiki') {
        const item = value as DemoWiki;
        wiki.push({
          id: row.id,
          kind: 'wiki',
          title: item.title,
          body: item.summary,
          author: names.get(item.editorId || '') || item.editor,
          authorId: item.editorId || '',
          status: 'v' + item.revisions,
          createdAt: item.updatedAt,
          target: item.id,
          href: '/#/wiki/' + item.id,
          wiki: item,
          boards: item.communities,
          protected:
            (!item.protectionUntil || new Date(item.protectionUntil) > new Date()) &&
            (item.protection ? item.protection === 'staff' : Boolean(item.protected)),
        });
      }
      if (row.kind === 'report') {
        const result = results.find((result) => result.report_id === row.id);
        if (value.evidence) {
          const report = value as StoredReport;
          flags.push({
            ...report.evidence,
            id: row.id,
            target: report.target,
            reason: report.reason,
            ...(report.categoryLabel ? { categoryLabel: report.categoryLabel } : {}),
            ...(report.detail !== undefined ? { reportDetail: report.detail } : {}),
            ...(names.get(report.userId) && names.get(report.userId) !== '已注销用户'
              ? { reporterId: report.userId }
              : {}),
            status: result?.outcome || 'pending',
            resolution: result?.reason || '',
            reporter: names.get(report.userId) || '已注销用户',
            createdAt: new Date(report.createdAt).toISOString(),
            ...(board && report.escalated && !result ? { status: 'escalated' } : {}),
          });
          continue;
        }
        flags.push({
          id: row.id,
          kind: 'post',
          title: '帖子举报',
          body: '',
          author: '',
          authorId: '',
          status: result?.outcome || (board && value.escalated ? 'escalated' : 'pending'),
          reason: value.reason,
          ...(names.get(value.userId) && names.get(value.userId) !== '已注销用户'
            ? { reporterId: String(value.userId) }
            : {}),
          resolution: result?.reason || '',
          reporter: names.get(value.userId) || '已注销用户',
          createdAt: new Date(value.createdAt).toISOString(),
          target: 'post:' + value.postId,
          href: '/#/posts/' + value.postId,
        });
      }
    }
    for (const flag of flags) {
      const stored = entities.find((row) => row.id === flag.id);
      const target = content.find((item) => item.id === flag.target);
      if (target) {
        flag.publishedAt ??= target.createdAt;
        flag.contentHidden = hidden.has(flag.target);
      }
      if (stored && JSON.parse(stored.data).evidence) continue;
      if (target)
        Object.assign(flag, {
          title: target.title,
          body: target.body,
          author: target.author,
          authorId: target.authorId,
          images: target.images,
          boards: target.boards,
        });
    }
    for (const report of reports) {
      if (flags.some((flag) => flag.target === 'message:' + report.message_id)) continue;
      const message = messages.find((message) => message.id === report.message_id);
      const result = results.find((result) => result.report_id === 'dm:' + report.id);
      flags.push({
        id: 'dm:' + report.id,
        kind: 'message',
        title: '私信举报',
        body: message?.text || '消息已不可用',
        author: names.get(message?.sender_id || '') || '已注销用户',
        authorId: message?.sender_id || '',
        status: result?.outcome || 'pending',
        reason: report.reason,
        resolution: result?.reason || '',
        reporter: names.get(report.reporter_id) || '已注销用户',
        createdAt: report.created_at.toISOString(),
        ...(message ? { publishedAt: message.created_at.toISOString() } : {}),
        ...(names.get(report.reporter_id) && names.get(report.reporter_id) !== '已注销用户'
          ? { reporterId: report.reporter_id }
          : {}),
        target: report.message_id,
        href: '',
      });
    }
    const scopedRestrictions = board ? localRestrictions : restrictions;
    const now = new Date();
    const people: AdminItem[] = users.map((user) => {
      const restriction = scopedRestrictions.find(
        (row) => row.user_id === user.id && row.until_at > new Date(),
      );
      const userPenalties = penalties.filter((p) => p.user_id === user.id);
      return {
        id: user.id,
        kind: 'user',
        title: names.get(user.id)!,
        ...(!user.deleted_at && user.handle ? { handle: user.handle } : {}),
        body: [restriction?.reason, ...userPenalties.map((p) => p.reason)]
          .filter(Boolean)
          .join('；'),
        author: '',
        authorId: user.id,
        status: user.deleted_at
          ? 'deleted'
          : restriction || userPenalties.some((p) => p.capability !== 'warning')
            ? 'restricted'
            : 'active',
        penalties: userPenalties.map((p) => ({
          id: p.id,
          capability: p.capability,
          board: p.board,
          reason: p.reason,
          until: p.until_at?.toISOString() || null,
        })),
        until: restriction?.until_at.toISOString() || null,
        suspended: userPenalties.some((p) => ['suspension', 'deactivation'].includes(p.capability)),
        muted: Boolean(
          restriction ||
          userPenalties.some((p) => ['publish', 'participation'].includes(p.capability)),
        ),
        createdAt: user.created_at.toISOString(),
        target: user.id,
        href: '/#/users/' + user.id,
      };
    });
    const scopedContent = board ? content.filter((item) => item.boards?.includes(board)) : content;
    const scopedWiki = board ? wiki.filter((item) => item.boards?.includes(board)) : wiki;
    const participants = new Set([...scopedContent, ...scopedWiki].map((item) => item.authorId));
    if (board) {
      for (const flag of flags) {
        if (
          ['account', 'profile'].includes(flag.kind) &&
          !flag.boards?.length &&
          participants.has(flag.authorId)
        )
          flag.boards = [board];
      }
    }
    for (const restriction of scopedRestrictions) participants.add(restriction.user_id);
    for (const penalty of penalties) participants.add(penalty.user_id);
    return {
      content: scopedContent,
      wiki: scopedWiki,
      flags: board ? flags.filter((item) => item.boards?.includes(board)) : flags,
      people: board && !includeAllPeople ? people.filter((item) => participants.has(item.id)) : people,
      names,
    };
  }

  async overview(board?: string) {
    const data = await this.data(this.db, board);
    return {
      pending: new Set(
        data.flags.filter((item) => item.status === 'pending').map((item) => item.target),
      ).size,
      posts: data.content.filter((item) => item.kind === 'post').length,
      replies: data.content.filter((item) => item.kind === 'reply').length,
      users: data.people.length,
      restricted: data.people.filter((item) => item.status === 'restricted').length,
      wiki: data.wiki.length,
    };
  }

  async list(query: AdminQuery, actorId?: string, verifiedAccess?: Awaited<ReturnType<typeof moderationAccess>>): Promise<AdminList> {
    const listAccess = actorId ? verifiedAccess ?? await requireScope(this.db, actorId, query.board) : undefined;
    const [data, listEffects, storedAppeals] = await Promise.all([
      this.data(this.db, query.board, query.section === 'users' && Boolean(query.record), query.section),
      dispositionEffects(this.db),
      query.section === 'appeals' ? this.db.selectFrom('moderation_appeals').selectAll().execute() : [],
    ]);
    let items: AdminItem[];
    if (query.section === 'trash') {
      items = data.content.filter((item) => item.status === 'hidden');
    } else if (query.section === 'reviews') {
      let reviews = this.db
        .selectFrom('post_reviews')
        .select(['id', 'board', 'user_id', 'status', 'reason', 'created_at'])
        .select(
          query.record
            ? 'data'
            : sql<string>`CAST(JSON_REMOVE(data, '$.images', '$.html') AS CHAR)`.as('data'),
        );
      if (query.board) reviews = reviews.where('board', '=', query.board);
      if (query.record) reviews = reviews.where('id', '=', query.record);
      items = (await reviews.execute()).map((review) => {
        const post = JSON.parse(review.data) as DemoPost;
        return {
          id: review.id,
          kind: 'post',
          title: post.title,
          body: post.body,
          target: review.id,
          author: data.names.get(review.user_id) || '已注销用户',
          authorId: review.user_id,
          status: review.status,
          createdAt: review.created_at.toISOString(),
          boards: [review.board],
          resolution: review.reason,
          images: post.images || [],
          href: review.status === 'approved' ? '/#/posts/' + post.id : '',
        };
      });
    } else if (query.section === 'appeals') {
      const appeals = storedAppeals;
      const originals = appeals.length ? await this.db
        .selectFrom('admin_actions')
        .selectAll()
        .where('id', 'in', appeals.map((row) => row.action_id))
        .execute() : [];
      const appealEffects = listEffects;
      items = appeals
        .filter((row) => {
          if (!query.board) return true;
          const effects = appealEffects.filter((effect) => effect.actionId === row.action_id);
          return effects.length
            ? effects.every((effect) => effect.board === query.board)
            : originals.some(
                (original) => original.id === row.action_id && original.board === query.board,
              );
        })
        .map((row) => ({
          id: row.id,
          target: row.id,
          kind: 'appeal',
          title: data.names.get(row.user_id) || '已注销用户',
          body: row.reason,
          reason: row.reason,
          resolution: row.resolution,
          author: data.names.get(row.user_id) || '',
          authorId: row.user_id,
          createdAt: row.created_at.toISOString(),
          status: row.status,
          href: '',
          ...(() => {
            const original = originals.find((item) => item.id === row.action_id);
            return original
              ? {
                  originalAction: {
                    action: original.action,
                    reason: original.reason,
                    actor: data.names.get(original.actor_id) || '已注销用户',
                    target: original.target,
                    createdAt: original.created_at.toISOString(),
                  },
                  boards: [
                    ...new Set(
                      appealEffects
                        .filter((effect) => effect.actionId === original.id)
                        .map((effect) => effect.board)
                        .filter((board): board is string => Boolean(board)),
                    ),
                  ],
                  manageable: original.actor_id !== actorId,
                }
              : {};
          })(),
        }));
    } else if (query.section === 'history') {
      let history = this.db.selectFrom('admin_actions').selectAll().orderBy('created_at', 'desc');
      if (query.board)
        history = history
          .where('board', '=', query.board)
          .where('action', 'not like', 'group.%')
          .where('action', 'not like', 'settings.%')
          .where('action', '!=', 'site.transfer');
      const rows = await history.execute();
      items = rows.map((row) => ({
        id: row.id,
        kind: (() => {
          const payload = JSON.parse(row.after_data);
          if (row.action === 'visibility')
            return payload?.hidden ? 'content.delete' : 'content.restore';
          if (row.action === 'case.resolve') {
            if (payload?.hidden && payload?.authorDisposition)
              return 'content.delete.participation';
            if (payload?.hidden) return 'content.delete';
            if (payload?.outcome === 'dismissed') return 'report.dismiss';
            if (payload?.accountPenalty?.capability === 'publish') return 'account.mute';
            if (payload?.accountPenalty?.capability === 'suspension') return 'account.suspend';
          }
          if (row.action === 'disposition')
            return payload?.capability || payload?.disposition?.kind || row.action;
          if (row.action === 'penalty' && payload?.capability === 'publish') return 'account.mute';
          if (row.action === 'penalty' && payload?.capability === 'suspension')
            return 'account.suspend';
          return row.action;
        })(),
        title:
          data.names.get(row.target) ||
          data.content.find((item) => item.target === row.target)?.title ||
          data.wiki.find((item) => item.target === row.target)?.title ||
          data.flags.find((item) => item.id === row.target || item.target === row.target)?.title ||
          (row.action === 'group.save'
            ? row.reason.replace(/^保存群组权限：/, '')
            : row.action === 'settings.site' || row.action === 'settings.invite'
              ? '站点设置'
              : row.action === 'post.review'
                ? JSON.parse(row.after_data).title
                : row.target),
        body: row.reason,
        author: data.names.get(row.actor_id) || '已注销用户',
        authorId: row.actor_id,
        status: 'recorded',
        createdAt: row.created_at.toISOString(),
        target: row.target,
        href: '',
      }));
    } else if (query.section === 'team') {
      let team = this.db
        .selectFrom('community_roles')
        .innerJoin('communities', 'communities.id', 'community_roles.community_id')
        .innerJoin('users', 'users.id', 'community_roles.user_id')
        .select([
          'users.id',
          'users.nickname',
          'users.created_at',
          'communities.slug',
          'community_roles.role',
        ]);
      if (query.board) team = team.where('communities.slug', '=', boardCommunities[query.board]!);
      items = (await team.execute()).flatMap((row) => {
        const board = Object.keys(boardCommunities).find(
          (key) => boardCommunities[key] === row.slug,
        );
        return board
          ? [
              {
                id: row.id + ':' + board,
                kind: 'user',
                title: row.nickname,
                author: '',
                authorId: row.id,
                body: row.role === 'owner' ? '社区主' : '版主',
                role: row.role,
                status: 'active',
                createdAt: row.created_at.toISOString(),
                target: row.id,
                href: '',
                boards: [board],
              },
            ]
          : [];
      });
    } else
      items =
        query.section === 'reports'
          ? data.flags
          : query.section === 'content'
            ? data.content
            : query.section === 'wiki'
              ? data.wiki
              : data.people;
    if (query.section === 'reports') {
      const groups = new Map<string, AdminItem>();
      for (const item of items) {
        const base = item.target + ':' + item.status + ':' + (item.resolution || '');
        let key = base;
        let batch = 1;
        while ((groups.get(key)?.reportIds?.length || 0) >= 500) key = base + ':' + batch++;
        const group = groups.get(key);
        const report = {
          id: item.id,
          reason: item.reason || '',
          reporter: item.reporter || '',
          ...(item.reporterId ? { reporterId: item.reporterId } : {}),
          ...(item.categoryLabel ? { categoryLabel: item.categoryLabel } : {}),
          ...(item.reportDetail !== undefined ? { detail: item.reportDetail } : {}),
          createdAt: item.createdAt,
        };
        if (group) {
          group.reportIds!.push(item.id);
          group.reports!.push(report);
          group.reason += String.fromCharCode(10) + item.reason;
          if (item.createdAt > group.createdAt) group.createdAt = item.createdAt;
        } else groups.set(key, { ...item, reportIds: [item.id], reports: [report] });
      }
      items = [...groups.values()];
    }
    if (actorId) {
      const access = listAccess!;
      items = items.map((item) => ({
        ...item,
        ...(item.wiki && !access.admin ? { wiki: publicWiki(item.wiki) } : {}),
        ...(query.section === 'reports' && !access.admin
          ? {
              reporter: '匿名举报人',
              reporterId: '',
              reports: (item.reports || []).map((report) => ({
                ...report,
                reporter: '匿名举报人',
                reporterId: '',
              })),
            }
          : {}),
        manageable:
          item.manageable !== false &&
          (access.admin ||
            item.kind === 'user' ||
            Boolean(
              query.board &&
              item.boards?.length &&
              item.boards.every((board) =>
                hasModerationPermission(
                  access,
                  board,
                  query.section === 'appeals'
                    ? 'appeals.view'
                    : query.section === 'wiki'
                      ? 'wiki'
                      : query.section === 'content' ||
                          query.section === 'reviews' ||
                          query.section === 'trash'
                        ? 'content'
                        : 'reports',
                ),
              ),
            )),
      }));
      if (!access.admin && query.section === 'reports') {
        items = items.map((item) => {
          const match = /^wiki:([^:]+)(?::([0-9]+))?$/.exec(item.target);
          const wiki = match && data.wiki.find((w) => w.target === match[1])?.wiki;
          if (wiki && (!match?.[2] || wiki.hiddenRevisions?.includes(Number(match[2]))))
            return {
              ...item,
              body: 'Wiki 举报证据由全站管理员核对',
              title: wiki.title,
              images: [],
            };
          return item;
        });
      }
    }
    if (query.section === 'users') {
      const [platform, custom, activity] = await Promise.all([
        this.db
          .selectFrom('platform_roles')
          .select('user_id')
          .where('role', 'in', ['owner', 'admin'])
          .execute(),
        this.db
          .selectFrom('moderation_group_members as member')
          .innerJoin('moderation_groups as group', 'group.id', 'member.group_id')
          .select([
            'member.user_id',
            'group.id',
            'member.boards as memberBoards',
            'group.boards',
            'group.permissions',
          ])
          .execute(),
        this.db
          .selectFrom('sessions')
          .select('user_id')
          .select((eb) => eb.fn.max<Date>('last_seen_at').as('lastSeenAt'))
          .groupBy('user_id')
          .execute(),
      ]);
      const staff = new Set(
        [
          ...platform,
          ...custom.filter(
            (row) =>
              JSON.parse(row.id === moderatorGroupId ? (row.memberBoards ?? '[]') : row.boards)
                .length && JSON.parse(row.permissions).length,
          ),
        ].map((row) => row.user_id),
      );
      const lastSeen = new Map(activity.map((row) => [row.user_id, row.lastSeenAt?.toISOString()]));
      items = items.map((item) => ({
        ...item,
        staff: staff.has(item.id),
        lastSeenAt: lastSeen.get(item.id) || null,
        manageable: item.manageable !== false,
      }));

    }
    const effects = listEffects;
    const appeals = storedAppeals;
    items = items.map((item) => ({
      ...item,
      effects: effects.filter(
        (effect) =>
          effect.actionId ===
            (appeals.find((appeal) => appeal.id === item.id)?.action_id || item.id) &&
          (!query.board || effect.board === query.board),
      ),
    }));
    const term = query.q.toLocaleLowerCase();
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    function matchesStatus(item: AdminItem) {
      if (query.status === 'all') return true;
      if (query.section === 'users' && query.board && query.status === 'restricted')
        return item.status !== 'deleted' && Boolean(item.muted || item.suspended);
      if (query.section !== 'users' || query.status === 'restricted')
        return item.status === query.status;
      if (item.status === 'deleted') return false;
      switch (query.status) {
        case 'active':
          return (item.lastSeenAt || '') >= cutoff;
        case 'new':
          return item.createdAt >= cutoff;
        case 'staff':
          return item.staff;
        case 'suspended':
          return item.suspended;
        case 'muted':
          return item.muted;
        default:
          return false;
      }
    }
    items = items.filter(
      (item) =>
        (!query.record || item.id === query.record || item.reportIds?.includes(query.record)) &&
        (Boolean(query.record) || matchesStatus(item)) &&
        (!query.kind ||
          query.kind === 'all' ||
          query.kind === item.kind ||
          (query.kind === 'user' && ['account', 'profile'].includes(item.kind))) &&
        [item.title, item.handle, item.body, item.author, item.reporter, item.reason].some(
          (value) => value?.toLocaleLowerCase().includes(term),
        ),
    );
    items.sort(
      (a, b) =>
        (query.section === 'users' && query.status === 'active'
          ? (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '')
          : 0) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
    if (query.section === 'reports' && query.record && items[0]?.status === 'handled') {
      const item = items[0];
      const history = await this.db
        .selectFrom('admin_actions')
        .selectAll()
        .where('target', '=', item.target)
        .where('action', 'in', ['case.resolve', 'visibility'])
        .orderBy('created_at', 'desc')
        .execute();
      const closure = history.find((row) => {
        if (row.action !== 'case.resolve') return false;
        const result = JSON.parse(row.after_data);
        return result?.hidden && result.reportIds?.includes(query.record);
      });
      if (closure)
        item.effects = effects.filter(
          (effect) =>
            effect.actionId === closure.id && (!query.board || effect.board === query.board),
        );
      if (closure)
        item.restorations = history
          .filter(
            (row) =>
              row.action === 'visibility' &&
              row.created_at >= closure.created_at &&
              JSON.parse(row.before_data)?.hidden &&
              JSON.parse(row.after_data)?.hidden === false,
          )
          .map((row) => ({
            id: row.id,
            author: data.names.get(row.actor_id) || '已注销用户',
            createdAt: row.created_at.toISOString(),
            reason: row.reason,
          }));
    }
    const visibleItems = items.slice((query.page - 1) * 25, query.page * 25);
    if (query.section === 'users' && actorId && listAccess?.admin) {
      const protectedIds = await protectedPlatformAccounts(this.db, listAccess, visibleItems.map(item => item.id));
      for (const item of visibleItems) item.manageable = !protectedIds.has(item.id);
    } else if (query.section === 'users' && actorId) {
      // Eligibility does not affect sorting/filtering. Only compute it for the
      // returned page, with bounded concurrency and one verified actor context.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(5, visibleItems.length) }, async () => {
        while (next < visibleItems.length) {
          const item = visibleItems[next++]!;
          try { await requireAccountManagement(this.db, actorId, item.id, query.board, listAccess); item.manageable = true; }
          catch { item.manageable = false; }
        }
      }));
    }
    return {
      items: visibleItems,
      total: items.length,
      page: query.page,
      pageSize: 25,
    };
  }

  async context(userId: string, board?: string) {
    const data = await this.data(this.db, board, true);
    const user = await this.db.selectFrom('users').select('id').where('id', '=', userId).where('kind', '=', 'member').executeTakeFirst();
    if (!user)
      throw new NotFoundException('USER_NOT_FOUND');
    let query = this.db.selectFrom('admin_actions').selectAll().orderBy('created_at', 'desc');
    if (board) query = query.where('board', '=', board);
    const records = (await query.execute()).filter((row) => {
      if (row.target === userId && ['disposition', 'penalty', 'restriction'].includes(row.action))
        return true;
      if (row.action === 'penalty.revoke') return JSON.parse(row.before_data)?.user_id === userId;
      return (
        row.action === 'case.resolve' &&
        JSON.parse(row.after_data)?.penaltyId &&
        JSON.parse(row.before_data)?.some((item: AdminItem) => item.authorId === userId)
      );
    });
    let expiryQuery = this.db
      .selectFrom('moderation_penalties')
      .selectAll()
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('superseded_by', 'is', null)
      .where('until_at', '<=', new Date())
      .where('capability', 'in', ['publish', 'suspension', 'participation', 'deactivation']);
    if (board) expiryQuery = expiryQuery.where('board', '=', board);
    const expiries = await expiryQuery.orderBy('until_at', 'desc').limit(50).execute();
    return {
      contributions: data.content.filter((item) => item.authorId === userId).length,
      records: [
        ...records.slice(0, 50).map((row) => {
          const payload = JSON.parse(row.after_data);
          const capability =
            payload?.authorDisposition?.kind ||
            payload?.disposition?.kind ||
            payload?.accountPenalty?.capability ||
            payload?.capability;
          return {
            id: row.id,
            action: ['publish', 'participation'].includes(capability)
              ? 'participation'
              : ['suspension', 'deactivation'].includes(capability)
                ? 'deactivation'
                : capability === 'warning'
                  ? 'warning'
                  : row.action,
            reason: row.reason,
            author: data.names.get(row.actor_id) || '已注销用户',
            createdAt: row.created_at.toISOString(),
          };
        }),
        ...expiries.flatMap((row) =>
          row.until_at
            ? [
                {
                  id: row.id + ':expired',
                  action: ['publish', 'participation'].includes(row.capability)
                    ? 'participation.expired'
                    : 'deactivation.expired',
                  reason: row.reason,
                  author: '系统',
                  createdAt: row.until_at.toISOString(),
                },
              ]
            : [],
        ),
      ]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50),
    };
  }

  private async notify(
    tx: Transaction<Database>,
    action: AdminAction,
    userId: string,
    text: string,
    href = '/#/settings',
  ) {
    const id = action.id + ':' + userId;
    const previous = await tx
      .selectFrom('admin_notifications')
      .select('text')
      .where('id', '=', id)
      .executeTakeFirst();
    const combined = previous
      ? [...new Set([...previous.text.split('，'), text])].join('，')
      : text;
    await tx
      .insertInto('admin_notifications')
      .values({
        id,
        user_id: userId,
        text: combined,
        detail: action.reason,
        href,
        created_at: new Date(),
      })
      .onDuplicateKeyUpdate({ text: combined, detail: action.reason })
      .execute();
  }

  async act(actorId: string, action: AdminAction, board?: string) {
    const hash = createHash('sha256')
      .update(JSON.stringify(board ? { action, board } : action))
      .digest('hex');
    if (action.action === 'member.role') throw new ForbiddenException('USE_GROUP_MANAGEMENT');
    await this.db.transaction().execute(async (tx) => {
      const global = await tx
        .selectFrom('demo_content')
        .selectAll()
        .where('id', '=', 'global')
        .forUpdate()
        .executeTakeFirstOrThrow();
      let operation = actionPermissions[action.action];
      switch (action.action) {
        case 'visibility':
          operation = action.hidden ? 'content.delete' : 'content.restore';
          break;
        case 'case.resolve':
          operation = 'content.delete';
          if (action.outcome === 'dismissed') operation = 'reports.dismiss';
          else if (action.target.startsWith('wiki:')) operation = 'wiki.edit';
          break;
        case 'case.escalate':
          operation = 'reports.escalate';
          break;
        case 'disposition':
          operation = 'users.manage';
          break;
        case 'penalty':
          operation = action.capability === 'suspension' ? 'users.suspend' : 'users.mute';
          break;
        case 'restriction':
          operation = 'users.mute';
          break;
        case 'appeal.review':
          operation = 'appeals.review';
          break;
        case 'wiki.manage':
        case 'wiki.restore':
        case 'wiki.protect':
          operation = 'wiki.edit';
          break;
        case 'post.settings':
        case 'content.label':
        case 'post.review':
          operation = 'content.delete';
          break;
        case 'report':
          operation = action.outcome === 'dismissed' ? 'reports.dismiss' : 'content.delete';
          break;
      }
      const access = await requireScope(tx, actorId, board, operation);
      if (
        action.action === 'penalty' &&
        !['warning', 'publish', 'suspension'].includes(action.capability) &&
        !access.admin
      )
        throw new ForbiddenException('PLATFORM_SCOPE_REQUIRED');
      if (action.action === 'note' && !access.admin)
        throw new ForbiddenException('PLATFORM_SCOPE_REQUIRED');
      if (action.action === 'disposition' && board && action.disposition.board !== board)
        throw new ForbiddenException('MODERATION_PERMISSION_REQUIRED');
      if (action.action === 'case.resolve' && action.authorDisposition) {
        if (!access.admin && board && action.authorDisposition.board !== board)
          throw new ForbiddenException('MODERATION_PERMISSION_REQUIRED');
        const scope =
          action.authorDisposition.scope === 'community'
            ? action.authorDisposition.board
            : undefined;
        await requireScope(tx, actorId, scope, 'users.manage');
      }
      if (action.action === 'restriction')
        await requireAccountManagement(tx, actorId, action.target);
      if (action.action === 'case.resolve') {
        if (action.hidden) await requireScope(tx, actorId, board, 'content.delete');
        if (action.hours || action.accountPenalty)
          await requireScope(
            tx,
            actorId,
            board,
            action.accountPenalty?.capability === 'suspension' ? 'users.suspend' : 'users.mute',
          );
        if (action.accountPenalty && (!access.admin || board))
          throw new ForbiddenException('PLATFORM_SCOPE_REQUIRED');
      }
      await requireCapability(tx, actorId, 'suspension', board ? [board] : []);
      const previous = await tx
        .selectFrom('admin_actions')
        .selectAll()
        .where('id', '=', action.id)
        .executeTakeFirst();
      if (previous) {
        if (previous.actor_id !== actorId || previous.request_hash !== hash)
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return;
      }
      let before: unknown = null;
      let after: unknown = action;
      const data = await this.data(tx, board, action.action === 'disposition');
      let scopedTarget =
        action.action === 'report'
          ? data.flags.find((item) => item.id === action.target)
          : action.action === 'case.resolve'
            ? data.flags.find((item) => item.target === action.target)
            : action.action.startsWith('wiki.')
              ? data.wiki.find((item) => item.target === action.target)
              : ['restriction', 'note', 'penalty', 'disposition'].includes(action.action)
                ? data.people.find((item) => item.id === action.target)
                : action.action === 'case.escalate'
                  ? data.flags.find((item) => item.target === action.target)
                  : data.content.find((item) => item.target === action.target);
      if (action.action === 'penalty.revoke') {
        const penalty = await tx
          .selectFrom('moderation_penalties')
          .selectAll()
          .where('id', '=', action.target)
          .executeTakeFirst();
        if (penalty)
          await requireScope(
            tx,
            actorId,
            board,
            penalty.capability === 'suspension' ? 'users.suspend' : 'users.mute',
          );
        scopedTarget =
          penalty && (!board || penalty.board === board)
            ? data.people.find((item) => item.id === penalty.user_id)
            : undefined;
      }
      if (
        board &&
        action.action !== 'post.review' &&
        action.action !== 'appeal.review' &&
        !scopedTarget
      )
        throw new ForbiddenException('MODERATION_PERMISSION_REQUIRED');
      let actionBoard = board;
      if (action.action === 'disposition') actionBoard = action.disposition.board;
      if (action.action === 'penalty.revoke') {
        const penalty = await tx
          .selectFrom('moderation_penalties')
          .select('board')
          .where('id', '=', action.target)
          .executeTakeFirst();
        actionBoard = penalty?.board || undefined;
      }
      if (action.action === 'post.review') {
        const review = await tx
          .selectFrom('post_reviews')
          .selectAll()
          .where('id', '=', action.target)
          .executeTakeFirst();
        if (!review || (board && review.board !== board))
          throw new NotFoundException('POST_REVIEW_NOT_FOUND');
        if (review.status !== 'pending') throw new ConflictException('POST_REVIEW_ALREADY_DECIDED');
        const post = JSON.parse(review.data) as DemoPost;
        if (action.outcome === 'approved') {
          const user = await tx
            .selectFrom('users')
            .select('id')
            .where('id', '=', review.user_id)
            .where('deleted_at', 'is', null)
            .executeTakeFirst();
          if (!user) throw new ConflictException('POST_REVIEW_AUTHOR_UNAVAILABLE');
          const data = JSON.stringify(await storeDemoAssets(tx, post));
          await tx
            .insertInto('demo_entities')
            .values({ id: 'post:' + post.id, kind: 'post', data })
            .execute();
          review.data = data;
        }
        await tx
          .updateTable('post_reviews')
          .set({ status: action.outcome, reason: action.reason, data: review.data })
          .where('id', '=', review.id)
          .execute();
        before = { status: review.status, title: post.title };
        after = { status: action.outcome, title: post.title };
        actionBoard = review.board;
        await this.notify(
          tx,
          action,
          review.user_id,
          action.outcome === 'approved'
            ? '首帖已通过审核：' + post.title
            : '首帖未通过审核：' + post.title,
          action.outcome === 'approved' ? '/#/posts/' + post.id : '/#/settings/governance',
        );
      }
      if (board && (action.action === 'case.resolve' || action.action === 'report')) {
        const current = data.content.find((item) => item.target === scopedTarget?.target);
        if (scopedTarget && ['post', 'reply'].includes(scopedTarget.kind) && !current)
          throw new ForbiddenException('CONTENT_MOVED_TO_OTHER_COMMUNITY');
        if (scopedTarget?.kind === 'wiki') {
          const currentWiki = data.wiki.find(
            (item) => item.target === scopedTarget.target.split(':')[1],
          );
          if (
            !currentWiki ||
            (!access.admin &&
              currentWiki.boards?.some(
                (board) =>
                  !hasModerationPermission(
                    access,
                    board,
                    action.action === 'case.resolve' && action.outcome === 'dismissed'
                      ? 'reports.dismiss'
                      : 'wiki.edit',
                  ),
              ))
          )
            throw new ForbiddenException('SHARED_WIKI_PERMISSION_REQUIRED');
        }
      }
      if (
        board &&
        (action.action.startsWith('wiki.') ||
          (action.action === 'case.resolve' && scopedTarget?.kind === 'wiki')) &&
        !access.admin &&
        scopedTarget?.boards?.some(
          (board) =>
            !hasModerationPermission(
              access,
              board,
              action.action === 'case.resolve' && action.outcome === 'dismissed'
                ? 'reports.dismiss'
                : 'wiki.edit',
            ),
        )
      )
        throw new ForbiddenException('SHARED_WIKI_PERMISSION_REQUIRED');
      if (
        [
          'disposition',
          'penalty',
          'penalty.revoke',
          'appeal.review',
          'case.escalate',
          'content.label',
          'wiki.manage',
        ].includes(action.action)
      ) {
        const result = await businessAction(tx, actorId, action, board);
        before = result.before;
        after = result.after;
        for (const notice of result.notices)
          await this.notify(tx, action, notice.userId, notice.text, '/#/settings');
      }
      if (action.action === 'post.settings') {
        const row = await tx
          .selectFrom('demo_entities')
          .selectAll()
          .where('id', '=', action.target)
          .where('kind', '=', 'post')
          .executeTakeFirst();
        if (!row) throw new NotFoundException('CONTENT_NOT_FOUND');
        const value = JSON.parse(row.data);
        if (action.community) await requireScope(tx, actorId, action.community, 'content');
        before = value;
        after = {
          ...value,
          ...(action.pinned === undefined ? {} : { pinned: action.pinned }),
          ...(action.locked === undefined ? {} : { locked: action.locked }),
          ...(action.archived === undefined ? {} : { archived: action.archived }),
          ...(action.community ? { community: action.community } : {}),
        };
        const updated = after as DemoPost;
        if (action.community && action.community !== value.community) {
          if (action.community !== 'market') {
            delete updated.price;
            delete updated.sold;
          }
          if (action.community !== 'buddies') {
            delete updated.meeting;
            delete updated.meetingAt;
          }
          if (action.community !== 'questions') delete updated.best;
          if (updated.wikiRef) {
            const wiki = data.wiki.find((item) => item.target === updated.wikiRef!.id)?.wiki;
            if (
              !wiki?.communities.includes(action.community) ||
              updated.wikiRef.answerId !== updated.best
            )
              delete updated.wikiRef;
          }
        }
        await tx
          .updateTable('demo_entities')
          .set({ data: JSON.stringify(after) })
          .where('id', '=', row.id)
          .execute();
        await this.notify(
          tx,
          action,
          value.authorId,
          '你的帖子管理状态已调整',
          '/#/posts/' + value.id,
        );
      }
      if (action.action === 'wiki.protect') {
        const row = await tx
          .selectFrom('demo_entities')
          .selectAll()
          .where('id', '=', 'wiki:' + action.target)
          .where('kind', '=', 'wiki')
          .executeTakeFirst();
        if (!row) throw new NotFoundException('WIKI_NOT_FOUND');
        before = JSON.parse(row.data);
        after = {
          ...(before as object),
          protected: action.protected,
          protection: action.protected ? 'staff' : 'open',
          protectionUntil: null,
        };
        await tx
          .updateTable('demo_entities')
          .set({ data: JSON.stringify(after) })
          .where('id', '=', row.id)
          .execute();
      }
      if (action.action === 'case.resolve') {
        const reports = data.flags.filter(
          (item) => item.target === action.target && action.reportIds.includes(item.id),
        );
        if (
          reports.length !== new Set(action.reportIds).size ||
          reports.some((item) => item.status !== 'pending')
        )
          throw new ConflictException('REPORT_ALREADY_RESOLVED');
        if (
          action.outcome === 'dismissed' &&
          (action.hidden || action.hours || action.accountPenalty || action.authorDisposition)
        )
          throw new ConflictException('INVALID_REPORT_ACTION');
        if (
          board &&
          action.outcome !== 'dismissed' &&
          reports.some((report) => ['account', 'profile'].includes(report.kind))
        )
          throw new ForbiddenException('PLATFORM_SCOPE_REQUIRED');
        before = reports;
        const previousVisibility = await tx
          .selectFrom('admin_visibility')
          .selectAll()
          .where('target', '=', action.target)
          .executeTakeFirst();
        const previousRestriction = board
          ? await tx
              .selectFrom('community_restrictions')
              .selectAll()
              .where('user_id', '=', reports[0]!.authorId)
              .where('board', '=', board)
              .executeTakeFirst()
          : await tx
              .selectFrom('admin_restrictions')
              .selectAll()
              .where('user_id', '=', reports[0]!.authorId)
              .executeTakeFirst();
        after = {
          ...action,
          previousVisibility: previousVisibility?.hidden || 0,
          previousRestriction: previousRestriction || null,
        };
        if (action.hidden) {
          if (!/^(post|reply):/.test(action.target))
            throw new ConflictException('INVALID_REPORT_ACTION');
          await tx
            .insertInto('admin_visibility')
            .values({ target: action.target, hidden: 1 })
            .onDuplicateKeyUpdate({ hidden: 1 })
            .execute();
        }
        const authorId = reports[0]!.authorId;
        if (action.authorDisposition?.scope === 'community') {
          const content = data.content.find((item) => item.target === action.target);
          if (!content?.boards?.includes(action.authorDisposition.board!))
            throw new ForbiddenException('MODERATION_PERMISSION_REQUIRED');
        }
        if (action.authorDisposition && (action.hours || action.accountPenalty))
          throw new ConflictException('INVALID_REPORT_ACTION');
        if (
          action.accountPenalty &&
          (!reports.every((report) => ['account', 'profile'].includes(report.kind)) ||
            action.hidden ||
            action.hours)
        )
          throw new ConflictException('INVALID_REPORT_ACTION');
        if (action.authorDisposition) {
          const result = await businessAction(
            tx,
            actorId,
            {
              id: action.id,
              action: 'disposition',
              target: authorId,
              disposition: action.authorDisposition,
              reason: action.reason,
            },
            board,
          );
          after = {
            ...(after as object),
            penaltyId: action.id,
            authorDisposition: action.authorDisposition,
          };
          for (const notice of result.notices)
            await this.notify(tx, action, notice.userId, notice.text, reports[0]!.href);
        }
        actionBoard = reports[0]!.boards?.[0] || board;
        if (action.hours || action.accountPenalty) {
          await businessAction(
            tx,
            actorId,
            {
              id: action.id,
              action: 'penalty',
              target: authorId,
              capability: action.accountPenalty?.capability || 'publish',
              hours: action.accountPenalty?.hours ?? action.hours,
              reason: action.reason,
            },
            board,
          );
          after = { ...(after as object), penaltyId: action.id };
        }
        if (action.hidden)
          await recordContentEffect(
            tx,
            action.id,
            action.target,
            reports[0]!.boards?.[0] || board || null,
            previousVisibility,
            action.reason,
          );
        if (action.hidden || action.hours || action.accountPenalty || action.authorDisposition)
          await this.notify(
            tx,
            action,
            authorId,
            action.hidden ? '你的内容已移入回收站' : '你的账号因举报处理受到限制',
            reports[0]!.href,
          );
        for (const report of reports) {
          await tx
            .insertInto('admin_report_results')
            .values({ report_id: report.id, outcome: action.outcome, reason: action.reason })
            .execute();
          const reporter = report.id.startsWith('dm:')
            ? (
                await tx
                  .selectFrom('dm_reports')
                  .select('reporter_id')
                  .where('id', '=', report.id.slice(3))
                  .executeTakeFirstOrThrow()
              ).reporter_id
            : JSON.parse(
                (
                  await tx
                    .selectFrom('demo_entities')
                    .select('data')
                    .where('id', '=', report.id)
                    .executeTakeFirstOrThrow()
                ).data,
              ).userId;
          await this.notify(
            tx,
            action,
            reporter,
            action.outcome === 'handled' ? '你的举报已处理' : '你的举报已驳回',
            '/#/me',
          );
        }
      }
      if (action.action === 'visibility') {
        const entity = await tx
          .selectFrom('demo_entities')
          .selectAll()
          .where('id', '=', action.target)
          .executeTakeFirst();
        if (!entity || !['post', 'reply'].includes(entity.kind))
          throw new NotFoundException('CONTENT_NOT_FOUND');
        before = (await tx
          .selectFrom('admin_visibility')
          .selectAll()
          .where('target', '=', action.target)
          .executeTakeFirst()) || { hidden: 0 };
        await tx
          .insertInto('admin_visibility')
          .values({ target: action.target, hidden: Number(action.hidden) })
          .onDuplicateKeyUpdate({ hidden: Number(action.hidden) })
          .execute();
        const value = JSON.parse(entity.data);
        const contentBoard =
          value.community ||
          data.content.find((item) => item.id === action.target)?.boards?.[0] ||
          board ||
          null;
        actionBoard = contentBoard || undefined;
        if (action.hidden)
          await recordContentEffect(
            tx,
            action.id,
            action.target,
            contentBoard,
            before,
            action.reason,
          );
        else
          await tx
            .updateTable('moderation_action_effects')
            .set({ reversed_by: action.id })
            .where('target', '=', action.target)
            .where('type', '=', 'content.delete')
            .where('reversed_by', 'is', null)
            .execute();
        await this.notify(
          tx,
          action,
          value.authorId,
          action.hidden ? '你的内容已移入回收站' : '你的内容已恢复展示',
          '/#/posts/' + (value.postId || value.id),
        );
      }
      if (action.action === 'report') {
        if (board && data.flags.find((item) => item.id === action.target)?.status === 'escalated')
          throw new ForbiddenException('PLATFORM_SCOPE_REQUIRED');
        const old = await tx
          .selectFrom('admin_report_results')
          .selectAll()
          .where('report_id', '=', action.target)
          .executeTakeFirst();
        if (old) throw new ConflictException('REPORT_ALREADY_RESOLVED');
        let reporter: string;
        if (action.target.startsWith('dm:')) {
          const report = await tx
            .selectFrom('dm_reports')
            .selectAll()
            .where('id', '=', action.target.slice(3))
            .executeTakeFirst();
          if (!report) throw new NotFoundException('REPORT_NOT_FOUND');
          reporter = report.reporter_id;
        } else {
          const report = await tx
            .selectFrom('demo_entities')
            .selectAll()
            .where('id', '=', action.target)
            .where('kind', '=', 'report')
            .executeTakeFirst();
          if (!report) throw new NotFoundException('REPORT_NOT_FOUND');
          reporter = JSON.parse(report.data).userId;
        }
        await tx
          .insertInto('admin_report_results')
          .values({ report_id: action.target, outcome: action.outcome, reason: action.reason })
          .execute();
        await this.notify(
          tx,
          action,
          reporter,
          action.outcome === 'handled' ? '你的举报已处理' : '你的举报已驳回',
          '/#/me',
        );
      }
      if (action.action === 'restriction') {
        before = scopedTarget || null;
        if (action.hours) {
          after = await applyDisposition(
            tx,
            actorId,
            action.target,
            {
              kind: 'participation',
              scope: board ? 'community' : 'global',
              ...(board ? { board: board as 'daily' } : {}),
              hours: action.hours,
              expectedVersion: null,
            },
            action.id,
            action.reason,
            false,
          );
        } else {
          let currentQuery = tx
            .selectFrom('moderation_penalties')
            .selectAll()
            .where('user_id', '=', action.target)
            .where('capability', '=', 'participation')
            .where('board', board ? '=' : 'is', board || null)
            .where('revoked_at', 'is', null)
            .where('superseded_by', 'is', null)
            .where((eb) => eb.or([eb('until_at', 'is', null), eb('until_at', '>', new Date())]));
          const current = await currentQuery.executeTakeFirst();
          if (current) before = await revokeDisposition(tx, actorId, current.id, board);
          after = { hours: 0 };
        }
        await this.notify(
          tx,
          action,
          action.target,
          (board ? '本社区' : '账号') +
            (action.hours ? '参与已限制 ' + action.hours + ' 小时' : '参与限制已解除'),
        );
      }
      if (action.action === 'wiki.restore') {
        const row = await tx
          .selectFrom('demo_entities')
          .selectAll()
          .where('id', '=', 'wiki:' + action.target)
          .where('kind', '=', 'wiki')
          .executeTakeFirst();
        if (!row) throw new NotFoundException('WIKI_NOT_FOUND');
        const wiki = JSON.parse(row.data) as DemoWiki;
        if (wiki.revisions !== action.baseRevision)
          throw new ConflictException('WIKI_REVISION_CONFLICT');
        const index = wiki.revisions - action.revision;
        const entry = wiki.history[index];
        if (wiki.hiddenRevisions?.includes(action.revision) && !access.admin)
          throw new ForbiddenException('HIDDEN_REVISION_PERMISSION_REQUIRED');
        if (index < 0 || !entry || action.revision === wiki.revisions)
          throw new ConflictException('INVALID_WIKI_REVISION');
        const parsed = WikiDraft.safeParse({
          communities: wiki.communities,
          table: null,
          ...(entry['after'] as object),
          id: wiki.id,
        });
        if (!parsed.success) throw new ConflictException('INVALID_WIKI_REVISION');
        const draft = parsed.data;
        if (
          board &&
          !access.admin &&
          (!draft.communities.includes(board as DemoPost['community']) ||
            draft.communities.some((board) => !hasModerationPermission(access, board, 'wiki.edit')))
        )
          throw new ForbiddenException('SHARED_WIKI_PERMISSION_REQUIRED');
        const name = await tx
          .selectFrom('users')
          .select('nickname')
          .where('id', '=', actorId)
          .executeTakeFirstOrThrow();
        before = WikiDraft.parse(wiki);
        const updated = {
          ...wiki,
          ...draft,
          revisions: wiki.revisions + 1,
          editor: name.nickname,
          editorId: actorId,
          updatedAt: new Date().toISOString(),
        };
        updated.history.unshift({
          at: updated.updatedAt,
          author: name.nickname,
          authorId: actorId,
          reason: action.reason,
          before,
          after: draft,
        });
        await tx
          .updateTable('demo_entities')
          .set({ data: JSON.stringify(updated) })
          .where('id', '=', row.id)
          .execute();
        after = draft;
      }
      await tx
        .insertInto('admin_actions')
        .values({
          id: action.id,
          board: actionBoard || null,
          actor_id: actorId,
          request_hash: hash,
          action: action.action,
          target: action.target,
          reason: action.reason,
          before_data: JSON.stringify(before),
          after_data: JSON.stringify(after),
          created_at: new Date(),
        })
        .execute();
      await tx
        .updateTable('demo_content')
        .set({ version: global.version + 1, updated_at: new Date() })
        .where('id', '=', 'global')
        .execute();
    });
    return { ok: true };
  }
}
