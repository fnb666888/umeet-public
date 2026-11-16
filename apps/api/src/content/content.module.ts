import {
  Controller,
  Get,
  Post as HttpPost,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Injectable,
  Module,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';
import { Database } from '../core/database';
import { containsText, sql } from '../core/database-dialect';
import { Actor, CurrentUser, Public, requireMember } from '../core/auth';
import {
  PostDto,
  FeedQuery,
  CommentDto,
  StateDto,
  ReactionDto,
  ReportDto,
  ReasonDto,
} from '../core/dto';

const relations = {
  author: true,
  campus: true,
  media: { select: { id: true } },
  _count: {
    select: {
      comments: { where: { status: 'PUBLISHED' } },
      reactions: { where: { type: 'LIKE' } },
    },
  },
} satisfies Prisma.PostInclude;
type FullPost = Prisma.PostGetPayload<{ include: typeof relations }>;
export function alias(postId: string, userId: string) {
  return (
    '同学 ' +
    createHmac('sha256', process.env.JWT_SECRET!)
      .update(postId + ':' + userId)
      .digest('hex')
      .slice(0, 4)
      .toUpperCase()
  );
}
const cursorFor = (p: { createdAt: Date; id: string }) =>
  Buffer.from(JSON.stringify([p.createdAt.toISOString(), p.id])).toString('base64url');
@Injectable()
export class ContentService {
  constructor(private db: Database) {}
  async member(user: Actor | undefined, schoolId: string) {
    if (!user) return false;
    const m = await this.db.membership.findUnique({
      where: { userId_schoolId: { userId: user.id, schoolId } },
    });
    return !!m && m.status === 'VERIFIED' && !!m.expiresAt && m.expiresAt > new Date();
  }
  async serialize(p: FullPost, user?: Actor, full = false) {
    const own = p.authorId === user?.id;
    const reactions = user
      ? await this.db.reaction.findMany({
          where: { userId: user.id, postId: p.id },
          select: { type: true },
        })
      : [];
    return {
      id: p.id,
      schoolId: p.schoolId,
      campusId: p.campusId,
      campusName: p.campus.name,
      category: p.category,
      title: p.title,
      content: full || own ? p.content : p.content.slice(0, 100),
      anonymous: p.anonymous,
      authorName: p.anonymous ? alias(p.id, p.authorId) : p.author.nickname,
      status: p.status,
      businessStatus: p.businessStatus,
      priceFen: p.priceFen,
      marketType: p.marketType,
      condition: p.condition,
      location: p.location,
      happenedAt: p.happenedAt,
      lostType: p.lostType,
      mediaIds: full || own ? p.media.map((m) => m.id) : [],
      likeCount: p._count.reactions,
      commentCount: p._count.comments,
      own,
      full: full || own,
      liked: reactions.some((r) => r.type === 'LIKE'),
      bookmarked: reactions.some((r) => r.type === 'BOOKMARK'),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      ...(own
        ? { moderationReason: p.moderationReason, version: p.version, contact: p.contact }
        : {}),
    };
  }
  async feed(query: FeedQuery, user?: Actor) {
    const schoolId = query.schoolId || 'demo-school';
    const full = await this.member(user, schoolId);
    if (query.category === 'TREEHOLE' && !full) throw new ForbiddenException('认证后可以浏览树洞');
    const blocks = user ? await this.db.block.findMany({ where: { userId: user.id } }) : [];
    const where: Prisma.PostWhereInput = {
      schoolId,
      status: 'PUBLISHED',
      campusId: query.campusId || undefined,
      category: query.category || (!full ? { not: 'TREEHOLE' } : undefined),
      authorId: blocks.length ? { notIn: blocks.map((b) => b.blockedId) } : undefined,
    };
    if (query.q?.trim())
      where.OR = [
        { title: containsText(query.q.trim()) },
        { content: containsText(query.q.trim()) },
      ];
    if (query.cursor) {
      try {
        const [date, id] = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
        const time = new Date(date);
        if (isNaN(time.getTime()) || typeof id !== 'string') throw new Error();
        where.AND = [{ OR: [{ createdAt: { lt: time } }, { createdAt: time, id: { lt: id } }] }];
      } catch {
        throw new BadRequestException('分页游标无效');
      }
    }
    // 热门仅排序近 7 天的最多 100 条；首版保持数据可控和可解释。
    if (query.sort === 'hot') {
      where.createdAt = { gt: new Date(Date.now() - 7 * 86400000) };
      if (query.cursor) throw new BadRequestException('热门列表不支持游标');
    }
    const rows = await this.db.post.findMany({
      where,
      include: relations,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.sort === 'hot' ? 100 : 21,
    });
    if (query.sort === 'hot')
      rows.sort(
        (a, b) =>
          (b._count.reactions + b._count.comments * 2 + 1) /
            Math.pow((Date.now() - b.createdAt.getTime()) / 3600000 + 2, 0.8) -
          (a._count.reactions + a._count.comments * 2 + 1) /
            Math.pow((Date.now() - a.createdAt.getTime()) / 3600000 + 2, 0.8),
      );
    const visible = rows.slice(0, 20);
    return {
      items: await Promise.all(visible.map((p) => this.serialize(p, user, full))),
      nextCursor: query.sort !== 'hot' && rows.length > 20 ? cursorFor(visible[19]) : null,
    };
  }
  async get(id: string, user?: Actor) {
    const post = await this.db.post.findUnique({ where: { id }, include: relations });
    if (
      !post ||
      post.status === 'DELETED' ||
      (post.status !== 'PUBLISHED' && post.authorId !== user?.id)
    )
      throw new NotFoundException('帖子不存在或暂不可见');
    const full = await this.member(user, post.schoolId);
    if (post.anonymous && !full && post.authorId !== user?.id)
      throw new ForbiddenException('认证后可以浏览树洞');
    if (
      user &&
      (await this.db.block.findUnique({
        where: { userId_blockedId: { userId: user.id, blockedId: post.authorId } },
      }))
    )
      throw new NotFoundException('帖子已屏蔽');
    return { post, full };
  }
  async validate(user: Actor, dto: PostDto) {
    if (dto.title.trim().length < 2 || dto.content.trim().length < 5)
      throw new BadRequestException('标题至少 2 字，正文至少 5 字');
    await requireMember(this.db, user, dto.schoolId);
    const campus = await this.db.campus.findUnique({ where: { id: dto.campusId } });
    if (!campus || campus.schoolId !== dto.schoolId)
      throw new BadRequestException('校区不属于该学校');
    if (dto.category === 'TREEHOLE') {
      const s = await this.db.school.findUniqueOrThrow({ where: { id: dto.schoolId } });
      if (!s.treeholeEnabled) throw new ForbiddenException('该学校暂未开放树洞');
      if (dto.contact) throw new BadRequestException('树洞不展示联系方式');
    }
    if (dto.anonymous && dto.category !== 'TREEHOLE')
      throw new BadRequestException('仅树洞允许匿名');
    if (dto.category === 'MARKET' && dto.priceFen == null)
      throw new BadRequestException('请填写二手价格');
    if (dto.category === 'LOST' && !dto.lostType) throw new BadRequestException('请选择丢失或拾到');
    if (dto.mediaIds && new Set(dto.mediaIds).size !== dto.mediaIds.length)
      throw new BadRequestException('重复图片');
  }
  async create(user: Actor, dto: PostDto, key: string) {
    if (!/^[\w-]{8,100}$/.test(key || ''))
      throw new BadRequestException('必须提供 Idempotency-Key');
    await this.validate(user, dto);
    const hash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    const previous = await this.db.post.findUnique({
      where: { authorId_requestKey: { authorId: user.id, requestKey: key } },
    });
    if (previous) {
      if (previous.requestHash !== hash)
        throw new ConflictException('同一请求标识不能用于不同内容');
      return { id: previous.id, status: previous.status };
    }
    return this.db.$transaction(async (tx) => {
      const media = await tx.media.findMany({ where: { id: { in: dto.mediaIds || [] } } });
      if (
        media.length !== (dto.mediaIds || []).length ||
        media.some((m) => m.userId !== user.id || m.purpose !== 'POST' || m.postId)
      )
        throw new BadRequestException('图片不可用于该帖子');
      const { mediaIds, draft, ...data } = dto;
      const post = await tx.post.create({
        data: {
          ...data,
          title: dto.title.trim(),
          content: dto.content.trim(),
          authorId: user.id,
          anonymous: dto.category === 'TREEHOLE',
          happenedAt: dto.happenedAt ? new Date(dto.happenedAt) : null,
          requestKey: key,
          requestHash: hash,
          status: draft ? 'DRAFT' : 'PENDING',
        },
      });
      const attached = await tx.media.updateMany({
        where: { id: { in: mediaIds || [] }, postId: null, userId: user.id },
        data: { postId: post.id },
      });
      if (attached.count !== (mediaIds || []).length)
        throw new ConflictException('图片已被其他帖子使用');
      if (!draft)
        await tx.outbox.create({
          data: { kind: 'MODERATE_POST', payload: { id: post.id, version: post.version } },
        });
      return { id: post.id, status: post.status };
    });
  }
  async edit(user: Actor, id: string, dto: PostDto) {
    await this.validate(user, dto);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(sql`SELECT id FROM "Post" WHERE id=${id} FOR UPDATE`);
      const p = await tx.post.findUniqueOrThrow({ where: { id } });
      if (p.authorId !== user.id || ['DELETED', 'HIDDEN'].includes(p.status))
        throw new ForbiddenException('无权编辑');
      if (p.schoolId !== dto.schoolId) throw new BadRequestException('不能转移帖子的学校');
      const media = await tx.media.findMany({ where: { id: { in: dto.mediaIds || [] } } });
      if (
        media.length !== (dto.mediaIds || []).length ||
        media.some(
          (m) => m.userId !== user.id || m.purpose !== 'POST' || (m.postId && m.postId !== id),
        )
      )
        throw new BadRequestException('图片不可用');
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: 'POST_EDIT',
          targetId: id,
          detail: { version: p.version, title: p.title, content: p.content },
        },
      });
      const { mediaIds, draft, ...data } = dto;
      const updated = await tx.post.update({
        where: { id },
        data: {
          ...data,
          anonymous: dto.category === 'TREEHOLE',
          happenedAt: dto.happenedAt ? new Date(dto.happenedAt) : null,
          version: { increment: 1 },
          status: draft ? 'DRAFT' : 'PENDING',
          moderationReason: '',
          contact: dto.contact || null,
          priceFen: dto.priceFen ?? null,
          condition: dto.condition || null,
          location: dto.location || null,
          lostType: dto.lostType || null,
        },
      });
      await tx.media.updateMany({ where: { postId: id }, data: { postId: null } });
      const attached = await tx.media.updateMany({
        where: { id: { in: mediaIds || [] }, postId: null, userId: user.id },
        data: { postId: id },
      });
      if (attached.count !== (mediaIds || []).length)
        throw new ConflictException('图片已被其他帖子使用');
      if (!draft)
        await tx.outbox.create({
          data: { kind: 'MODERATE_POST', payload: { id, version: updated.version } },
        });
      return { id, status: updated.status };
    });
  }
  async contact(user: Actor, id: string) {
    const { post } = await this.get(id, user);
    await requireMember(this.db, user, post.schoolId);
    if (post.anonymous || post.status !== 'PUBLISHED')
      throw new ForbiddenException('不提供联系方式');
    await this.db.audit.create({
      data: { actorId: user.id, action: 'CONTACT_VIEW', targetId: id, detail: {} },
    });
    return { contact: post.contact || null };
  }
}
@ApiTags('content')
@ApiBearerAuth()
@Controller()
class ContentController {
  constructor(
    private db: Database,
    private service: ContentService,
  ) {}
  @Public() @Get('schools') schools() {
    return this.db.school.findMany({ include: { campuses: true }, orderBy: { name: 'asc' } });
  }
  @Public() @Get('posts') feed(@Query() q: FeedQuery, @CurrentUser() user?: Actor) {
    return this.service.feed(q, user);
  }
  @Public() @Get('posts/:id') async detail(@Param('id') id: string, @CurrentUser() user?: Actor) {
    const { post, full } = await this.service.get(id, user);
    return this.service.serialize(post, user, full);
  }
  @HttpPost('posts') create(
    @Body() dto: PostDto,
    @CurrentUser() user: Actor,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.create(user, dto, key);
  }
  @Put('posts/:id') edit(
    @Body() dto: PostDto,
    @CurrentUser() user: Actor,
    @Param('id') id: string,
  ) {
    return this.service.edit(user, id, dto);
  }
  @Delete('posts/:id') async remove(@CurrentUser() user: Actor, @Param('id') id: string) {
    const p = await this.db.post.findUniqueOrThrow({ where: { id } });
    if (p.authorId !== user.id) throw new ForbiddenException('只能删除自己的帖子');
    await this.db.post.update({
      where: { id },
      data: { status: 'DELETED', contact: null, version: { increment: 1 } },
    });
    return { ok: true };
  }
  @Put('posts/:id/state') async state(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: StateDto,
  ) {
    const p = await this.db.post.findUniqueOrThrow({ where: { id } });
    if (p.authorId !== user.id || p.status !== 'PUBLISHED')
      throw new ForbiddenException('只能管理自己已发布的帖子');
    const states =
      p.category === 'MARKET'
        ? ['ACTIVE', 'SOLD', 'CLOSED']
        : p.category === 'LOST'
          ? ['ACTIVE', 'FOUND', 'CLOSED']
          : p.category === 'HELP'
            ? ['ACTIVE', 'SOLVED', 'CLOSED']
            : ['ACTIVE', 'CLOSED'];
    if (!states.includes(dto.state)) throw new BadRequestException('不适用该类别的状态');
    await this.db.post.update({ where: { id }, data: { businessStatus: dto.state } });
    return { ok: true };
  }
  @Get('posts/:id/contact') contact(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.contact(user, id);
  }
  @HttpPost('posts/:id/reactions') async react(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: ReactionDto,
  ) {
    const { post } = await this.service.get(id, user);
    await requireMember(this.db, user, post.schoolId);
    if (post.status !== 'PUBLISHED') throw new BadRequestException('帖子尚未发布');
    const where = { userId_postId_type: { userId: user.id, postId: id, type: dto.type } };
    if (dto.active)
      await this.db.reaction.upsert({ where, create: where.userId_postId_type, update: {} });
    else await this.db.reaction.deleteMany({ where: where.userId_postId_type });
    return { ok: true };
  }
  @Get('posts/:id/comments') async comments(@CurrentUser() user: Actor, @Param('id') id: string) {
    const { post } = await this.service.get(id, user);
    await requireMember(this.db, user, post.schoolId);
    const blocks = await this.db.block.findMany({ where: { userId: user.id } });
    const comments = await this.db.comment.findMany({
      where: {
        postId: id,
        authorId: { notIn: blocks.map((b) => b.blockedId) },
        OR: [
          { status: 'PUBLISHED' },
          { authorId: user.id, status: { in: ['PENDING', 'REJECTED'] } },
        ],
      },
      include: { author: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return comments.map((c) => ({
      id: c.id,
      content: c.content,
      parentId: c.parentId,
      authorName: post.anonymous ? alias(id, c.authorId) : c.author.nickname,
      own: c.authorId === user.id,
      author: c.authorId === post.authorId,
      createdAt: c.createdAt,
      status: c.status,
      ...(c.authorId === user.id ? { reason: c.reason } : {}),
    }));
  }
  @HttpPost('posts/:id/comments') async comment(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: CommentDto,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(sql`SELECT id FROM "Post" WHERE id=${id} FOR SHARE`);
      const p = await tx.post.findUniqueOrThrow({ where: { id } });
      await requireMember(this.db, user, p.schoolId);
      if (p.status !== 'PUBLISHED') throw new BadRequestException('帖子暂不可评论');
      if (dto.parentId) {
        const parent = await tx.comment.findUnique({ where: { id: dto.parentId } });
        if (!parent || parent.postId !== id || parent.status !== 'PUBLISHED')
          throw new BadRequestException('回复目标无效');
      }
      const c = await tx.comment.create({
        data: {
          postId: id,
          authorId: user.id,
          content: dto.content.trim(),
          parentId: dto.parentId,
        },
      });
      await tx.outbox.create({ data: { kind: 'MODERATE_COMMENT', payload: { id: c.id } } });
      return { id: c.id, status: c.status };
    });
  }
  @Delete('comments/:id') async deleteComment(@CurrentUser() user: Actor, @Param('id') id: string) {
    const c = await this.db.comment.findUniqueOrThrow({ where: { id } });
    if (c.authorId !== user.id) throw new ForbiddenException('只能删除自己的评论');
    await this.db.comment.update({ where: { id }, data: { status: 'DELETED' } });
    return { ok: true };
  }
  @HttpPost('posts/:id/reports') async report(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: ReportDto,
  ) {
    const { post } = await this.service.get(id, user);
    await requireMember(this.db, user, post.schoolId);
    let comment;
    if (dto.commentId) {
      comment = await this.db.comment.findUnique({ where: { id: dto.commentId } });
      if (!comment || comment.postId !== id || comment.status !== 'PUBLISHED')
        throw new BadRequestException('评论不存在');
    }
    return this.db.report.create({
      data: {
        userId: user.id,
        postId: id,
        commentId: dto.commentId,
        reason: dto.reason,
        snapshot: {
          title: post.title,
          content: comment?.content || post.content,
          version: post.version,
        },
      },
      select: { id: true },
    });
  }
  @HttpPost('posts/:id/block-author') async block(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
  ) {
    const { post } = await this.service.get(id, user);
    await requireMember(this.db, user, post.schoolId);
    if (post.authorId === user.id) throw new BadRequestException('不能屏蔽自己');
    await this.db.block.upsert({
      where: { userId_blockedId: { userId: user.id, blockedId: post.authorId } },
      create: { userId: user.id, blockedId: post.authorId },
      update: {},
    });
    return { ok: true };
  }
  @Get('me/blocks') async blocks(@CurrentUser() user: Actor) {
    const blocks = await this.db.block.findMany({ where: { userId: user.id } });
    return blocks.map((b) => ({ id: b.id, label: '已屏蔽用户', createdAt: b.createdAt }));
  }
  @Delete('me/blocks/:id') async unblock(@CurrentUser() user: Actor, @Param('id') id: string) {
    await this.db.block.deleteMany({ where: { id, userId: user.id } });
    return { ok: true };
  }
  @Get('me/posts') async mine(@CurrentUser() user: Actor) {
    return Promise.all(
      (
        await this.db.post.findMany({
          where: { authorId: user.id, status: { not: 'DELETED' } },
          include: relations,
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      ).map((p) => this.service.serialize(p, user, true)),
    );
  }
  @Get('me/bookmarks') async bookmarks(@CurrentUser() user: Actor) {
    const rows = await this.db.post.findMany({
      where: { status: 'PUBLISHED', reactions: { some: { userId: user.id, type: 'BOOKMARK' } } },
      include: relations,
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
    const result = [];
    for (const p of rows) {
      if (await this.service.member(user, p.schoolId))
        result.push(await this.service.serialize(p, user, true));
    }
    return result;
  }
  @Get('me/comments') async myComments(@CurrentUser() user: Actor) {
    return this.db.comment.findMany({
      where: { authorId: user.id, status: { not: 'DELETED' } },
      select: {
        id: true,
        postId: true,
        content: true,
        status: true,
        reason: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @HttpPost('posts/:id/appeal') async appeal(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    const p = await this.db.post.findUniqueOrThrow({ where: { id } });
    if (p.authorId !== user.id || !['HIDDEN', 'REJECTED'].includes(p.status))
      throw new ForbiddenException('该帖子不可申诉');
    return this.db.report.create({
      data: {
        userId: user.id,
        postId: id,
        reason: '申诉：' + dto.reason,
        snapshot: { title: p.title, content: p.content, version: p.version },
      },
      select: { id: true },
    });
  }
}
@Module({
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
