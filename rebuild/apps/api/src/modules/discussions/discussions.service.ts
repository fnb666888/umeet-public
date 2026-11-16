import { boardSlug, communitySlug } from '../../../../../packages/contracts/src/boards.js';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type { Actor } from '../../../../../packages/contracts/src/index.js';
import type {
  CommentInput,
  PostInput,
  Vote,
} from '../../../../../packages/contracts/src/discussions.js';
import { AuditService } from '../audit/audit.service.js';
import { requireCommunityUnrestricted, requireUnrestricted } from '../admin/restrictions.js';
import { boardCommunities, moderationAccess } from '../admin/scope.js';
import { permits, type ModerationPermission } from '../../../../../packages/contracts/src/admin.js';

const pageSize = 20;
export class DiscussionsService {
  constructor(private readonly db: Kysely<Database>) {}

  private publicPosts() {
    return this.db
      .selectFrom('discussion_posts as p')
      .innerJoin('communities as c', 'c.id', 'p.community_id')
      .innerJoin('users as u', 'u.id', 'p.author_id')
      .select([
        'p.id',
        'c.slug as communitySlug',
        'c.name as communityName',
        sql<string>`case when c.slug = 'hollow' then '匿名用户' else u.nickname end`.as('author'),
        'p.title',
        'p.body',
        'p.published_at as publishedAt',
        sql<number>`coalesce((select sum(value) from discussion_votes where post_id = p.id), 0)`.as(
          'score',
        ),
        sql<number>`(select count(*) from discussion_comments r
          left join discussion_comments parent on parent.id = r.parent_id
          where r.post_id = p.id and r.state = 'public'
            and (r.parent_id is null or parent.state = 'public'))`.as('replyCount'),
      ])
      .where('p.state', '=', 'public');
  }

  private formatPost<T extends { publishedAt: Date | null; score: number; replyCount: number }>(
    row: T,
  ) {
    return {
      ...row,
      publishedAt: row.publishedAt!.toISOString(),
      score: Number(row.score),
      replyCount: Number(row.replyCount),
    };
  }

  async list(community?: string, after?: string, search?: string) {
    let query = this.publicPosts();
    if (community) query = query.where('c.slug', '=', community);
    if (search)
      query = query.where(
        sql<boolean>`(locate(lower(${search}), lower(p.title)) > 0 or locate(lower(${search}), lower(p.body)) > 0)`,
      );
    if (after) {
      const cursor = await query.where('p.id', '=', after).executeTakeFirst();
      if (!cursor?.publishedAt) throw new NotFoundException('DISCUSSION_CURSOR_EXPIRED');
      const date = cursor.publishedAt;
      query = query.where((eb) =>
        eb.or([
          eb('p.published_at', '<', date),
          eb.and([eb('p.published_at', '=', date), eb('p.id', '<', after)]),
        ]),
      );
    }
    const rows = await query
      .orderBy('p.published_at', 'desc')
      .orderBy('p.id', 'desc')
      .limit(pageSize + 1)
      .execute();
    const items = rows.slice(0, pageSize).map((row) => this.formatPost(row));
    return { items, nextCursor: rows.length > pageSize ? items.at(-1)!.id : null };
  }

  async detail(id: string, actor: Actor | null) {
    const row = await this.publicPosts().where('p.id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundException('DISCUSSION_NOT_FOUND');
    const [comments, vote, roles] = await Promise.all([
      this.db
        .selectFrom('discussion_comments as r')
        .innerJoin('users as u', 'u.id', 'r.author_id')
        .leftJoin('discussion_comments as parent', 'parent.id', 'r.parent_id')
        .select(['r.id', 'r.parent_id as parentId', 'r.body', 'r.created_at as createdAt'])
        .select(
          row.communitySlug === 'hollow'
            ? sql<string>`'匿名用户'`.as('author')
            : 'u.nickname as author',
        )
        .where('r.post_id', '=', id)
        .where('r.state', '=', 'public')
        .where((eb) => eb.or([eb('r.parent_id', 'is', null), eb('parent.state', '=', 'public')]))
        .orderBy('r.created_at')
        .orderBy('r.id')
        .execute(),
      actor?.kind === 'member'
        ? this.db
            .selectFrom('discussion_votes')
            .select('value')
            .where('post_id', '=', id)
            .where('user_id', '=', actor.userId)
            .executeTakeFirst()
        : undefined,
      actor?.kind === 'member' ? this.roles(actor) : [],
    ]);
    return {
      post: this.formatPost(row),
      comments,
      vote: vote?.value ?? 0,
      canModerate: roles === null || roles.some((role) => role === row.communitySlug),
    };
  }

  async create(actor: Actor, input: PostInput) {
    await requireUnrestricted(this.db, actor.userId);
    const community = await this.db
      .selectFrom('communities')
      .select('id')
      .where('slug', '=', input.community)
      .executeTakeFirst();
    if (community) await requireCommunityUnrestricted(this.db, actor.userId, community.id);
    if (!community) throw new NotFoundException('COMMUNITY_NOT_FOUND');
    await this.db
      .insertInto('discussion_posts')
      .values({
        id: input.id,
        community_id: community.id,
        author_id: actor.userId,
        title: input.title,
        body: input.body,
        state: 'public',
        created_at: new Date(),
        published_at: new Date(),
      })
      .onDuplicateKeyUpdate({ id: sql`id` })
      .execute();
    const row = await this.db
      .selectFrom('discussion_posts')
      .selectAll()
      .where('id', '=', input.id)
      .executeTakeFirstOrThrow();
    if (
      row.author_id !== actor.userId ||
      row.community_id !== community.id ||
      row.title !== input.title ||
      row.body !== input.body
    )
      throw new ConflictException('DISCUSSION_REQUEST_CONFLICT');
    return { id: row.id, state: row.state };
  }

  private async lockPublicPost(db: Kysely<Database>, id: string) {
    const post = await db
      .selectFrom('discussion_posts')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (post?.state !== 'public') throw new NotFoundException('DISCUSSION_NOT_FOUND');
    return post;
  }

  async comment(actor: Actor, postId: string, input: CommentInput) {
    await requireUnrestricted(this.db, actor.userId);
    return this.db.transaction().execute(async (tx) => {
      const post = await this.lockPublicPost(tx, postId);
      await requireCommunityUnrestricted(tx, actor.userId, post.community_id);
      if (input.parentId) {
        const parent = await tx
          .selectFrom('discussion_comments')
          .select('id')
          .where('id', '=', input.parentId)
          .where('post_id', '=', postId)
          .where('state', '=', 'public')
          .where('parent_id', 'is', null)
          .executeTakeFirst();
        if (!parent) throw new NotFoundException('COMMENT_PARENT_NOT_FOUND');
      }
      await tx
        .insertInto('discussion_comments')
        .values({
          id: input.id,
          post_id: postId,
          author_id: actor.userId,
          parent_id: input.parentId,
          body: input.body,
          state: 'public',
          created_at: new Date(),
        })
        .onDuplicateKeyUpdate({ id: sql`id` })
        .execute();
      const row = await tx
        .selectFrom('discussion_comments')
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirstOrThrow();
      if (
        row.post_id !== postId ||
        row.author_id !== actor.userId ||
        row.body !== input.body ||
        row.parent_id !== input.parentId
      )
        throw new ConflictException('DISCUSSION_REQUEST_CONFLICT');
      return { id: row.id, state: row.state };
    });
  }

  async vote(actor: Actor, postId: string, value: Vote) {
    await requireUnrestricted(this.db, actor.userId, [], 'interact');
    return this.db.transaction().execute(async (tx) => {
      const post = await this.lockPublicPost(tx, postId);
      await requireCommunityUnrestricted(tx, actor.userId, post.community_id, 'interact');
      if (value === 0) {
        await tx
          .deleteFrom('discussion_votes')
          .where('post_id', '=', postId)
          .where('user_id', '=', actor.userId)
          .execute();
      } else {
        await tx
          .insertInto('discussion_votes')
          .values({ post_id: postId, user_id: actor.userId, value })
          .onDuplicateKeyUpdate({ value })
          .execute();
      }
      const { score } = await tx
        .selectFrom('discussion_votes')
        .select(sql<number>`coalesce(sum(value), 0)`.as('score'))
        .where('post_id', '=', postId)
        .executeTakeFirstOrThrow();
      return { value, score: Number(score) };
    });
  }

  async report(actor: Actor, postId: string, reason: string) {
    await this.db.transaction().execute(async (tx) => {
      await this.lockPublicPost(tx, postId);
      await tx
        .insertInto('discussion_reports')
        .values({ post_id: postId, user_id: actor.userId, reason })
        .onDuplicateKeyUpdate({ reason })
        .execute();
    });
    return { ok: true };
  }

  private async roles(actor: Actor, permission: ModerationPermission = 'content.delete') {
    const access = await moderationAccess(this.db, actor.userId);
    if (access.admin) return null;
    return access.boards
      .filter((entry) => permits(entry.permissions, permission))
      .map((entry) => communitySlug(entry.board));
  }

  async reviewQueue(actor: Actor) {
    const roles = await this.roles(actor, 'reports.view');
    if (roles?.length === 0) throw new ForbiddenException('DISCUSSION_MODERATOR_REQUIRED');
    let posts = this.db
      .selectFrom('discussion_posts as p')
      .innerJoin('communities as c', 'c.id', 'p.community_id')
      .select(['p.id', 'c.slug as communitySlug', 'p.title', 'p.body', 'p.state'])
      .where('p.state', '=', 'public')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('discussion_reports as r')
            .select('r.post_id')
            .whereRef('r.post_id', '=', 'p.id'),
        ),
      );
    if (roles) posts = posts.where('c.slug', 'in', roles);
    const postRows = await posts.orderBy('p.created_at').limit(30).execute();
    const reports = postRows.length
      ? await this.db
          .selectFrom('discussion_reports')
          .select(['post_id', 'reason'])
          .where(
            'post_id',
            'in',
            postRows.map((row) => row.id),
          )
          .execute()
      : [];
    return {
      posts: postRows.map((row) => ({
        ...row,
        reports: reports.filter((r) => r.post_id === row.id).map((r) => r.reason),
      })),
    };
  }

  async review(
    actor: Actor,
    kind: 'post' | 'comment',
    id: string,
    decision: 'publish' | 'hide',
    reason: string,
  ) {
    const roles = await this.roles(
      actor,
      decision === 'publish' ? 'content.restore' : 'content.delete',
    );
    return this.db.transaction().execute(async (tx) => {
      const comment =
        kind === 'comment'
          ? await tx
              .selectFrom('discussion_comments')
              .selectAll()
              .where('id', '=', id)
              .executeTakeFirst()
          : null;
      if (kind === 'comment' && !comment) throw new NotFoundException('COMMENT_NOT_FOUND');
      const post = await tx
        .selectFrom('discussion_posts as p')
        .innerJoin('communities as c', 'c.id', 'p.community_id')
        .select(['p.id', 'p.state', 'p.published_at', 'c.slug'])
        .where('p.id', '=', comment?.post_id ?? id)
        .forUpdate()
        .executeTakeFirst();
      if (!post) throw new NotFoundException('DISCUSSION_NOT_FOUND');
      const board = boardSlug(post.slug);
      await requireUnrestricted(tx, actor.userId, board ? [board] : [], 'suspension');
      if (roles && !roles.includes(post.slug))
        throw new ForbiddenException('DISCUSSION_MODERATOR_REQUIRED');
      const state = decision === 'publish' ? 'public' : 'hidden';
      if (comment) {
        if (decision === 'publish') {
          await this.lockPublicPost(tx, post.id);
          if (comment.parent_id) {
            const parent = await tx
              .selectFrom('discussion_comments')
              .select('state')
              .where('id', '=', comment.parent_id)
              .forUpdate()
              .executeTakeFirst();
            if (parent?.state !== 'public')
              throw new ConflictException('COMMENT_PARENT_NOT_PUBLIC');
          }
        }
        await tx.updateTable('discussion_comments').set({ state }).where('id', '=', id).execute();
      } else {
        await tx
          .updateTable('discussion_posts')
          .set({
            state,
            published_at: post.published_at ?? (state === 'public' ? new Date() : null),
          })
          .where('id', '=', id)
          .execute();
        await tx.deleteFrom('discussion_reports').where('post_id', '=', id).execute();
      }
      await new AuditService().append(tx, {
        actorId: actor.userId,
        targetId: id,
        kind: 'discussion.' + kind + '.' + decision,
        reason,
      });
      return { ok: true };
    });
  }
}
