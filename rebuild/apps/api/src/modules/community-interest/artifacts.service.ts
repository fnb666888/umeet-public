import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import {
  ArtifactActionInput,
  ArtifactCommentInput,
  ArtifactReportInput,
  ModerationInput,
  type ArtifactDetail,
  type ArtifactKind,
} from '../../../../../packages/contracts/src/interest.js';
import { adminActor, audit, parse, writeActor, type InterestDb } from './common.js';
import { NewsService } from './news.service.js';
import { ForecastsService } from './forecasts.service.js';
import { hasModerationPermission, moderationAccess, requireScope } from '../admin/scope.js';

import { notifyFollowers } from './notifications.js';

export class ArtifactsService {
  constructor(readonly db: InterestDb) {}
  async item(kind: ArtifactKind, id: string) {
    return kind === 'news'
      ? new NewsService(this.db).get(id)
      : new ForecastsService(this.db).get(id);
  }
  async board(kind: ArtifactKind, id: string) {
    await this.item(kind, id);
    const row =
      kind === 'news'
        ? await this.db
            .selectFrom('interest_news')
            .select('board')
            .where('id', '=', id)
            .where('state', '=', 'published')
            .executeTakeFirst()
        : await this.db
            .selectFrom('interest_forecasts')
            .select('board')
            .where('id', '=', id)
            .where('state', '!=', 'hidden')
            .executeTakeFirst();
    if (!row) throw new NotFoundException('ITEM_NOT_FOUND');
    return row.board;
  }
  async detail(kind: ArtifactKind, id: string, userId: string | null): Promise<ArtifactDetail> {
    const item = await this.item(kind, id);
    const rows = await this.db
      .selectFrom('interest_comments')
      .innerJoin('users', 'users.id', 'interest_comments.author_id')
      .selectAll('interest_comments')
      .select(['users.nickname', 'users.deleted_at'])
      .where('target_type', '=', kind)
      .where('target_id', '=', id)
      .orderBy('created_at', 'desc')
      .orderBy('interest_comments.id', 'desc')
      .limit(100)
      .execute();
    const actions = userId
      ? await this.db
          .selectFrom('interest_actions')
          .select('kind')
          .where('user_id', '=', userId)
          .where('target_type', '=', kind)
          .where('target_id', '=', id)
          .execute()
      : [];
    return {
      item,
      comments: rows.reverse().map((r) => ({
        id: r.id,
        author: r.deleted_at ? '已注销用户' : r.nickname,
        authorId: r.hidden ? '' : r.author_id,
        body: r.hidden ? '该评论已被隐藏' : r.body,
        createdAt: r.created_at.toISOString(),
        hidden: !!r.hidden,
      })),
      saved: actions.some((a) => a.kind === 'save'),
      followed: actions.some((a) => a.kind === 'follow'),
    };
  }
  async comment(ctx: RequestContext, kind: ArtifactKind, id: string, input: unknown) {
    const board = await this.board(kind, id),
      actor = await writeActor(this.db, ctx, [board], 'publish'),
      data = parse(ArtifactCommentInput, input);
    await this.db.transaction().execute(async (tx) => {
      // Serialize a member's writes to apply the same rate bound across API instances.
      await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', actor.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const existing = await tx
        .selectFrom('interest_comments')
        .selectAll()
        .where('id', '=', data.id)
        .executeTakeFirst();
      if (existing) {
        if (
          existing.author_id !== actor.userId ||
          existing.target_type !== kind ||
          existing.target_id !== id ||
          existing.body !== data.body
        )
          throw new ConflictException('COMMENT_ID_REUSED');
        return;
      }
      const recent = await tx
        .selectFrom('interest_comments')
        .select((eb) => eb.fn.count<number>('id').as('count'))
        .where('author_id', '=', actor.userId)
        .where('created_at', '>', new Date(Date.now() - 60000))
        .executeTakeFirstOrThrow();
      if (Number(recent.count) >= 5) throw new BadRequestException('COMMENT_RATE_LIMIT');
      await tx
        .insertInto('interest_comments')
        .values({
          id: data.id,
          target_type: kind,
          target_id: id,
          author_id: actor.userId,
          body: data.body,
          hidden: 0,
          created_at: new Date(),
        })
        .execute();
      await notifyFollowers(
        tx,
        kind,
        id,
        'comment:' + data.id,
        '你关注的' + (kind === 'news' ? '资讯' : '预测') + '有新评论',
        actor.userId,
      );
    });
    return this.detail(kind, id, actor.userId);
  }
  async action(ctx: RequestContext, kind: ArtifactKind, id: string, input: unknown) {
    const board = await this.board(kind, id),
      actor = await writeActor(this.db, ctx, [board]),
      data = parse(ArtifactActionInput, input);
    if (data.active)
      await this.db
        .insertInto('interest_actions')
        .values({
          user_id: actor.userId,
          target_type: kind,
          target_id: id,
          kind: data.kind,
          created_at: new Date(),
        })
        .onDuplicateKeyUpdate({ user_id: actor.userId })
        .execute();
    else
      await this.db
        .deleteFrom('interest_actions')
        .where('user_id', '=', actor.userId)
        .where('target_type', '=', kind)
        .where('target_id', '=', id)
        .where('kind', '=', data.kind)
        .execute();
    return this.detail(kind, id, actor.userId);
  }
  async saved(ctx: RequestContext) {
    const actor = await writeActor(this.db, ctx);
    return this.db
      .selectFrom('interest_actions')
      .select(['target_type as type', 'target_id as id', 'kind', 'created_at as createdAt'])
      .where('user_id', '=', actor.userId)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
  }
  async report(ctx: RequestContext, kind: ArtifactKind, id: string, input: unknown) {
    const board = await this.board(kind, id),
      actor = await writeActor(this.db, ctx, [board]),
      data = parse(ArtifactReportInput, input);
    if (
      data.commentId &&
      !(await this.db
        .selectFrom('interest_comments')
        .select('id')
        .where('id', '=', data.commentId)
        .where('target_type', '=', kind)
        .where('target_id', '=', id)
        .executeTakeFirst())
    )
      throw new NotFoundException('COMMENT_NOT_FOUND');
    await this.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', actor.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const duplicate = await tx
        .selectFrom('interest_reports')
        .select('id')
        .where('user_id', '=', actor.userId)
        .where('target_type', '=', kind)
        .where('target_id', '=', id)
        .where('comment_id', data.commentId ? '=' : 'is', data.commentId || null)
        .where('state', '=', 'pending')
        .executeTakeFirst();
      if (duplicate) return { ok: true };
      const recent = await tx
        .selectFrom('interest_reports')
        .select((eb) => eb.fn.count<number>('id').as('count'))
        .where('user_id', '=', actor.userId)
        .where('created_at', '>', new Date(Date.now() - 3600000))
        .executeTakeFirstOrThrow();
      if (Number(recent.count) >= 20) throw new BadRequestException('REPORT_RATE_LIMIT');
      await tx
        .insertInto('interest_reports')
        .values({
          id: randomUUID(),
          user_id: actor.userId,
          target_type: kind,
          target_id: id,
          comment_id: data.commentId || null,
          reason: data.reason,
          state: 'pending',
          resolution: '',
          created_at: new Date(),
        })
        .execute();
    });
    return { ok: true };
  }
  async management(ctx: RequestContext) {
    const actor = await writeActor(this.db, ctx);
    const access = await moderationAccess(this.db, actor.userId);
    if (
      !access.admin &&
      !access.boards.some((b) => hasModerationPermission(access, b.board, 'reports.view'))
    )
      throw new ForbiddenException('MODERATION_PERMISSION_REQUIRED');
    const reports = await this.db
      .selectFrom('interest_reports')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    const result = [];
    for (const report of reports) {
      const item =
        report.target_type === 'news'
          ? await this.db
              .selectFrom('interest_news')
              .select(['board', 'title'])
              .where('id', '=', report.target_id)
              .executeTakeFirst()
          : await this.db
              .selectFrom('interest_forecasts')
              .select(['board', 'title'])
              .where('id', '=', report.target_id)
              .executeTakeFirst();
      if (item && hasModerationPermission(access, item.board, 'reports.view')) {
        const comment = report.comment_id
          ? await this.db
              .selectFrom('interest_comments')
              .select(['body', 'hidden'])
              .where('id', '=', report.comment_id)
              .executeTakeFirst()
          : null;
        result.push({
          ...report,
          board: item.board,
          title: item.title,
          commentBody: comment?.body || null,
          commentHidden: !!comment?.hidden,
        });
      }
    }
    return result;
  }
  async moderate(ctx: RequestContext, input: unknown) {
    const actor = await writeActor(this.db, ctx),
      data = parse(ModerationInput, input);
    let targetType = data.targetType,
      targetId = data.targetId;
    if (targetType === 'comment') {
      const comment = await this.db
        .selectFrom('interest_comments')
        .selectAll()
        .where('id', '=', targetId)
        .executeTakeFirst();
      if (!comment) throw new NotFoundException('COMMENT_NOT_FOUND');
      targetType = comment.target_type as 'news' | 'forecast';
      targetId = comment.target_id;
    }
    const target =
      targetType === 'news'
        ? await this.db
            .selectFrom('interest_news')
            .select('board')
            .where('id', '=', targetId)
            .executeTakeFirst()
        : await this.db
            .selectFrom('interest_forecasts')
            .select('board')
            .where('id', '=', targetId)
            .executeTakeFirst();
    if (!target) throw new NotFoundException('ITEM_NOT_FOUND');
    await requireScope(
      this.db,
      actor.userId,
      target.board,
      data.hidden ? 'content.delete' : 'content.restore',
    );
    await this.db.transaction().execute(async (tx) => {
      if (data.targetType === 'comment')
        await tx
          .updateTable('interest_comments')
          .set({ hidden: Number(data.hidden) })
          .where('id', '=', data.targetId)
          .execute();
      else if (data.targetType === 'news')
        await tx
          .updateTable('interest_news')
          .set({ state: data.hidden ? 'hidden' : 'published' })
          .where('id', '=', data.targetId)
          .execute();
      else {
        const row = await tx
          .selectFrom('interest_forecasts')
          .select('state')
          .where('id', '=', data.targetId)
          .forUpdate()
          .executeTakeFirst();
        if (!row) throw new NotFoundException('FORECAST_NOT_FOUND');
        // Keep outcome lifecycle independent of visibility via existing visibility table.
        await tx
          .insertInto('admin_visibility')
          .values({ target: 'forecast:' + data.targetId, hidden: Number(data.hidden) })
          .onDuplicateKeyUpdate({ hidden: Number(data.hidden) })
          .execute();
      }
      await audit(
        tx,
        actor.userId,
        'interest.moderate',
        data.targetType + ':' + data.targetId,
        data.reason,
      );
      const type = data.targetType === 'comment' ? null : data.targetType;
      let reports = tx
        .updateTable('interest_reports')
        .set({ state: 'handled', resolution: data.reason });
      if (type)
        reports = reports.where('target_type', '=', type).where('target_id', '=', data.targetId);
      else reports = reports.where('comment_id', '=', data.targetId);
      await reports.execute();
    });
    return { ok: true };
  }
}
