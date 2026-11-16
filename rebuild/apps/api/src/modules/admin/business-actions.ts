import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Insertable, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type { AdminAction, AdminItem } from '../../../../../packages/contracts/src/admin.js';
import { WikiDraft, type DemoWiki } from '../demo/demo.schema.js';
import { moderationAccess, requireAccountManagement } from './scope.js';
import { applyDisposition, revokeDisposition, reviewEffects } from './dispositions.js';
import type { StoredReport } from './governance.service.js';

export async function businessAction(
  tx: Transaction<Database>,
  actorId: string,
  action: AdminAction,
  board?: string,
) {
  let before: unknown = null;
  let after: unknown = action;
  const notices: { userId: string; text: string }[] = [];
  if (action.action === 'disposition') {
    after = await applyDisposition(
      tx,
      actorId,
      action.target,
      action.disposition,
      action.id,
      action.reason,
    );
    before = (after as { previous: unknown }).previous;
    notices.push({
      userId: action.target,
      text:
        action.disposition.kind === 'warning'
          ? '你收到一项警告'
          : action.disposition.kind === 'deactivation'
            ? '你的账号已停用'
            : (action.disposition.board ? '本社区' : '全站') + '参与权限已受限',
    });
  }
  if (action.action === 'penalty') {
    const kind =
      action.capability === 'publish' || (board && action.capability === 'suspension')
        ? 'participation'
        : action.capability === 'suspension'
          ? 'deactivation'
          : action.capability;
    if (['warning', 'participation', 'deactivation'].includes(kind)) {
      after = await applyDisposition(
        tx,
        actorId,
        action.target,
        {
          kind: kind as 'warning' | 'participation' | 'deactivation',
          scope: board ? 'community' : 'global',
          ...(board ? { board: board as 'daily' } : {}),
          hours: action.hours || null,
          expectedVersion: null,
        },
        action.id,
        action.reason,
        false,
      );
      before = (after as { previous: unknown }).previous;
    } else {
      await requireAccountManagement(tx, actorId, action.target);
      if (board) throw new ForbiddenException('PLATFORM_SCOPE_REQUIRED');
      after = {
        id: action.id,
        user_id: action.target,
        board: null,
        capability: kind,
        reason: action.reason,
        until_at: action.hours ? new Date(Date.now() + action.hours * 3600000) : null,
        revoked_at: null,
        created_at: new Date(),
      };
      await tx
        .insertInto('moderation_penalties')
        .values(after as Insertable<Database['moderation_penalties']>)
        .execute();
    }
    notices.push({
      userId: action.target,
      text:
        kind === 'warning'
          ? '你收到一项警告'
          : kind === 'deactivation'
            ? '你的账号已停用'
            : '你的参与权限已受限',
    });
  }
  if (action.action === 'penalty.revoke') {
    before = await revokeDisposition(tx, actorId, action.target, board, action.expectedVersion);
    const released = before as { user_id: string; board: string | null };
    await tx
      .insertInto('moderation_action_effects')
      .values({
        id: action.id + ':release',
        action_id: action.id,
        type: 'restriction.release',
        target: released.user_id,
        board: released.board,
        penalty_id: null,
        before_data: JSON.stringify(before),
        after_data: JSON.stringify({ reason: action.reason }),
        reversed_by: null,
        created_at: new Date(),
      })
      .execute();
    notices.push({ userId: (before as { user_id: string }).user_id, text: '一项管理限制已解除' });
  }
  if (action.action === 'case.escalate') {
    const rows = await tx
      .selectFrom('demo_entities')
      .selectAll()
      .where('kind', '=', 'report')
      .execute();
    const results = new Set(
      (await tx.selectFrom('admin_report_results').select('report_id').execute()).map(
        (item) => item.report_id,
      ),
    );
    const pending = rows.filter((row) => {
      const report = JSON.parse(row.data) as StoredReport & { postId?: string };
      return (
        (report.target || 'post:' + report.postId) === action.target &&
        !results.has(row.id) &&
        (!board ||
          !report.evidence ||
          report.evidence.boards?.includes(board) ||
          ['account', 'profile'].includes(report.evidence.kind))
      );
    });
    if (!pending.length) throw new NotFoundException('REPORT_NOT_FOUND');
    before = pending.map((row) => JSON.parse(row.data));
    for (const row of pending) {
      const report = JSON.parse(row.data) as StoredReport;
      await tx
        .updateTable('demo_entities')
        .set({ data: JSON.stringify({ ...report, escalated: true }) })
        .where('id', '=', row.id)
        .execute();
    }
  }
  if (action.action === 'content.label') {
    const row = await tx
      .selectFrom('demo_entities')
      .selectAll()
      .where('id', '=', action.target)
      .executeTakeFirst();
    if (!row || !['post', 'reply'].includes(row.kind))
      throw new NotFoundException('CONTENT_NOT_FOUND');
    const value = JSON.parse(row.data);
    before = value.moderationLabels || {};
    const labels = { ...value.moderationLabels };
    if (action.value) labels[action.label] = action.reason;
    else delete labels[action.label];
    after = labels;
    await tx
      .updateTable('demo_entities')
      .set({ data: JSON.stringify({ ...value, moderationLabels: labels }) })
      .where('id', '=', row.id)
      .execute();
    notices.push({
      userId: value.authorId,
      text: action.label === 'revision' ? '管理人员要求你修改内容' : '你的内容管理标记已调整',
    });
  }
  if (action.action === 'wiki.manage') {
    const row = await tx
      .selectFrom('demo_entities')
      .selectAll()
      .where('id', '=', 'wiki:' + action.target)
      .where('kind', '=', 'wiki')
      .executeTakeFirst();
    if (!row) throw new NotFoundException('WIKI_NOT_FOUND');
    const wiki = JSON.parse(row.data) as DemoWiki;
    before = JSON.parse(row.data);
    if (action.protection) {
      wiki.protection = action.protection;
      wiki.protected = action.protection === 'staff';
      wiki.protectionUntil = action.hours
        ? new Date(Date.now() + action.hours * 3600000).toISOString()
        : null;
    }
    if (action.quality) wiki.quality = action.quality;
    if (action.title && action.title !== wiki.title) {
      const rows = await tx
        .selectFrom('demo_entities')
        .select('data')
        .where('kind', '=', 'wiki')
        .execute();
      if (
        rows.some((row) => {
          const other = JSON.parse(row.data) as DemoWiki;
          return (
            other.id !== wiki.id &&
            [other.title, ...(other.previousTitles || [])].includes(action.title!)
          );
        })
      )
        throw new ConflictException('WIKI_TITLE_EXISTS');
      wiki.previousTitles = [...new Set([...(wiki.previousTitles || []), wiki.title])];
      const previous = WikiDraft.parse(wiki);
      wiki.title = action.title;
      const editor = await tx
        .selectFrom('users')
        .select('nickname')
        .where('id', '=', actorId)
        .executeTakeFirstOrThrow();
      wiki.revisions++;
      wiki.editor = editor.nickname;
      wiki.editorId = actorId;
      wiki.updatedAt = new Date().toISOString();
      wiki.history.unshift({
        at: wiki.updatedAt,
        author: editor.nickname,
        authorId: actorId,
        reason: action.reason,
        before: previous,
        after: WikiDraft.parse(wiki),
      });
    }
    if (action.revision !== undefined) {
      const index = wiki.revisions - action.revision;
      if (index < 0 || !wiki.history[index]) throw new ConflictException('INVALID_WIKI_REVISION');
      if (action.hidden !== undefined) {
        if (action.revision === wiki.revisions && action.hidden)
          throw new ConflictException('CURRENT_REVISION_CANNOT_HIDE');
        if (!(await moderationAccess(tx, actorId)).admin)
          throw new ForbiddenException('PLATFORM_SCOPE_REQUIRED');
        const revisions = new Set(wiki.hiddenRevisions || []);
        if (action.hidden) revisions.add(action.revision);
        else revisions.delete(action.revision);
        wiki.hiddenRevisions = [...revisions];
      }
      if (action.patrolled !== undefined) {
        const revisions = new Set(wiki.patrolledRevisions || []);
        if (action.patrolled) revisions.add(action.revision);
        else revisions.delete(action.revision);
        wiki.patrolledRevisions = [...revisions];
      }
    }
    after = wiki;
    await tx
      .updateTable('demo_entities')
      .set({ data: JSON.stringify(wiki) })
      .where('id', '=', row.id)
      .execute();
  }
  if (action.action === 'appeal.review') {
    const appeal = await tx
      .selectFrom('moderation_appeals')
      .selectAll()
      .where('id', '=', action.target)
      .executeTakeFirst();
    if (!appeal) throw new NotFoundException('APPEAL_NOT_FOUND');
    if (appeal.status !== 'pending') throw new ConflictException('APPEAL_ALREADY_REVIEWED');
    const original = await tx
      .selectFrom('admin_actions')
      .selectAll()
      .where('id', '=', appeal.action_id)
      .executeTakeFirstOrThrow();
    if (board && original.board !== board)
      throw new ForbiddenException('MODERATION_PERMISSION_REQUIRED');
    if (original.actor_id === actorId)
      throw new ForbiddenException('INDEPENDENT_REVIEWER_REQUIRED');
    before = appeal;
    const effects = await tx
      .selectFrom('moderation_action_effects')
      .selectAll()
      .where('action_id', '=', original.id)
      .execute();
    if (effects.length) {
      const decisions =
        action.decisions ||
        effects.map((effect) => ({ effectId: effect.id, outcome: action.outcome }));
      await reviewEffects(tx, actorId, original, decisions, action.id);
      const outcomes = decisions.map((decision) => decision.outcome);
      const status = outcomes.every((value) => value === 'reversed')
        ? 'reversed'
        : outcomes.every((value) => value === 'upheld')
          ? 'upheld'
          : 'partial';
      after = { ...action, outcome: status };
      await tx
        .updateTable('moderation_appeals')
        .set({ status, resolution: action.reason })
        .where('id', '=', appeal.id)
        .execute();
      notices.push({
        userId: appeal.user_id,
        text:
          status === 'partial'
            ? '申诉复核完成，部分处置已撤销'
            : status === 'reversed'
              ? '申诉通过，相关处置已撤销'
              : '申诉复核完成，维持原处置',
      });
      return { before, after, notices };
    }
    if (action.outcome === 'reversed') {
      await tx
        .updateTable('moderation_penalties')
        .set({ revoked_at: new Date() })
        .where('id', '=', original.id)
        .where('revoked_at', 'is', null)
        .execute();
      if (
        original.action === 'visibility' ||
        original.action === 'case.resolve' ||
        original.action === 'content.label'
      ) {
        const later = await tx
          .selectFrom('admin_actions')
          .select('id')
          .where('target', '=', original.target)
          .where('action', 'in', ['visibility', 'case.resolve', 'content.label'])
          .where('created_at', '>=', original.created_at)
          .where('id', '!=', original.id)
          .executeTakeFirst();
        if (later) throw new ConflictException('NEWER_DISPOSITION_EXISTS');
        if (original.action === 'content.label') {
          const entity = await tx
            .selectFrom('demo_entities')
            .selectAll()
            .where('id', '=', original.target)
            .executeTakeFirst();
          if (entity)
            await tx
              .updateTable('demo_entities')
              .set({
                data: JSON.stringify({
                  ...JSON.parse(entity.data),
                  moderationLabels: JSON.parse(original.before_data),
                }),
              })
              .where('id', '=', entity.id)
              .execute();
        } else {
          const old = JSON.parse(original.before_data);
          const next = JSON.parse(original.after_data);
          if (original.action === 'visibility' || next.hidden) {
            const hidden =
              original.action === 'visibility'
                ? Number(old.hidden)
                : Number(next.previousVisibility || 0);
            await tx
              .insertInto('admin_visibility')
              .values({ target: original.target, hidden })
              .onDuplicateKeyUpdate({ hidden })
              .execute();
          }
        }
      }
      if (
        original.action === 'restriction' ||
        (original.action === 'case.resolve' &&
          JSON.parse(original.after_data).hours &&
          !JSON.parse(original.after_data).penaltyId)
      ) {
        const next = JSON.parse(original.after_data);
        const old = JSON.parse(original.before_data);
        const userId = original.action === 'restriction' ? original.target : old[0]?.authorId;
        const previous =
          original.action === 'restriction'
            ? { until_at: old?.until, reason: old?.body || '' }
            : next.previousRestriction;
        const current = original.board
          ? await tx
              .selectFrom('community_restrictions')
              .selectAll()
              .where('user_id', '=', userId)
              .where('board', '=', original.board)
              .executeTakeFirst()
          : await tx
              .selectFrom('admin_restrictions')
              .selectAll()
              .where('user_id', '=', userId)
              .executeTakeFirst();
        if (
          !current ||
          current.until_at.toISOString() !== next.until ||
          current.reason !== original.reason
        )
          throw new ConflictException('NEWER_DISPOSITION_EXISTS');
        const restored = {
          until_at: previous?.until_at ? new Date(previous.until_at) : new Date(0),
          reason: previous?.reason || '',
        };
        if (original.board)
          await tx
            .updateTable('community_restrictions')
            .set(restored)
            .where('user_id', '=', userId)
            .where('board', '=', original.board)
            .execute();
        else
          await tx
            .updateTable('admin_restrictions')
            .set(restored)
            .where('user_id', '=', userId)
            .execute();
      }
    }
    await tx
      .updateTable('moderation_appeals')
      .set({ status: action.outcome, resolution: action.reason })
      .where('id', '=', appeal.id)
      .execute();
    notices.push({
      userId: appeal.user_id,
      text: action.outcome === 'reversed' ? '申诉通过，相关处置已撤销' : '申诉复核完成，维持原处置',
    });
  }
  return { before, after, notices };
}
