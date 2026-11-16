import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Injectable,
  Module,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Database } from '../core/database';
import { sql } from '../core/database-dialect';
import { Admin, Actor, CurrentUser, checkAdminScope } from '../core/auth';
import {
  ReviewDto,
  CommentReviewDto,
  VerifyReviewDto,
  BanDto,
  SchoolDto,
  CampusDto,
  ReasonDto,
  PostDto,
} from '../core/dto';
import { randomUUID } from 'node:crypto';
import { alias } from '../content/content.module';

@Injectable()
export class OperationsService {
  constructor(private db: Database) {}
  async review(user: Actor, id: string, dto: ReviewDto) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(sql`SELECT id FROM "Post" WHERE id=${id} FOR UPDATE`);
      const p = await tx.post.findUniqueOrThrow({ where: { id } });
      checkAdminScope(user, p.schoolId);
      if (p.version !== dto.version || ['DELETED', 'DRAFT'].includes(p.status))
        throw new ConflictException('内容已变更，请刷新审核');
      if (dto.decision === 'APPROVE' && p.anonymous) {
        const s = await tx.school.findUniqueOrThrow({ where: { id: p.schoolId } });
        if (!s.treeholeEnabled) throw new BadRequestException('学校树洞尚未开启');
      }
      const status =
        dto.decision === 'APPROVE'
          ? 'PUBLISHED'
          : dto.decision === 'REJECT'
            ? 'REJECTED'
            : 'HIDDEN';
      if (p.status === status && p.moderationReason === dto.reason) return { ok: true };
      await tx.post.update({ where: { id }, data: { status, moderationReason: dto.reason } });
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: 'POST_' + dto.decision,
          targetId: id,
          detail: { reason: dto.reason, version: p.version, before: p.status, after: status },
        },
      });
      await tx.outbox.create({
        data: {
          kind: 'NOTIFY',
          payload: {
            userId: p.authorId,
            title: status === 'PUBLISHED' ? '你的帖子已发布' : '帖子审核结果',
            body: dto.reason,
            postId: id,
          },
        },
      });
      return { ok: true };
    });
  }
}
@ApiTags('operations')
@ApiBearerAuth()
@Admin()
@Controller('admin')
class OperationsController {
  constructor(
    private db: Database,
    private service: OperationsService,
  ) {}
  scope(user: Actor) {
    return user.role === 'SCHOOL_ADMIN' ? { schoolId: user.adminSchoolId || '__none__' } : {};
  }
  @Get('overview') async overview(@CurrentUser() user: Actor) {
    const scope = this.scope(user);
    const [posts, pending, comments, reports, verifications, members, recent] = await Promise.all([
      this.db.post.count({ where: { ...scope, status: 'PUBLISHED' } }),
      this.db.post.count({ where: { ...scope, status: 'PENDING' } }),
      this.db.comment.count({ where: { status: 'PENDING', post: scope } }),
      this.db.report.count({ where: { status: 'OPEN', post: scope } }),
      this.db.verification.count({ where: { ...scope, status: 'PENDING', method: 'MANUAL' } }),
      this.db.membership.count({
        where: { ...scope, status: 'VERIFIED', expiresAt: { gt: new Date() } },
      }),
      this.db.post.findMany({
        where: { ...scope, createdAt: { gt: new Date(Date.now() - 7 * 86400000) } },
        select: { createdAt: true },
        take: 10000,
      }),
    ]);
    const trend = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10);
      return {
        date,
        count: recent.filter((p) => p.createdAt.toISOString().slice(0, 10) === date).length,
      };
    });
    return { posts, pending, comments, reports, verifications, members, trend };
  }
  @Get('posts') async posts(@CurrentUser() user: Actor, @Query('status') status = 'PENDING') {
    if (!['PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN'].includes(status))
      throw new BadRequestException('状态无效');
    const rows = await this.db.post.findMany({
      where: { ...this.scope(user), status },
      include: { school: true, campus: true, media: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((p) => ({
      id: p.id,
      schoolId: p.schoolId,
      schoolName: p.school.name,
      campusName: p.campus.name,
      category: p.category,
      title: p.title,
      content: p.content,
      anonymous: p.anonymous,
      version: p.version,
      status: p.status,
      moderationReason: p.moderationReason,
      mediaIds: p.media.map((m) => m.id),
      createdAt: p.createdAt,
    }));
  }
  @Post('posts/:id/review') review(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.service.review(user, id, dto);
  }
  @Post('posts/:id/trace') async trace(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    if (user.role !== 'PLATFORM_ADMIN') throw new ForbiddenException('仅平台授权管理员可追溯');
    const p = await this.db.post.findUniqueOrThrow({ where: { id }, include: { author: true } });
    await this.db.audit.create({
      data: {
        actorId: user.id,
        action: 'IDENTITY_TRACE',
        targetId: id,
        detail: { reason: dto.reason },
      },
    });
    return { userId: p.authorId, nickname: p.author.nickname };
  }
  @Get('comments') comments(@CurrentUser() user: Actor) {
    return this.db.comment.findMany({
      where: { status: 'PENDING', post: this.scope(user) },
      select: {
        id: true,
        postId: true,
        content: true,
        reason: true,
        createdAt: true,
        post: { select: { title: true, schoolId: true, anonymous: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }
  @Post('comments/:id/review') async comment(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: CommentReviewDto,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(sql`SELECT id FROM "Comment" WHERE id=${id} FOR UPDATE`);
      const c = await tx.comment.findUniqueOrThrow({ where: { id }, include: { post: true } });
      checkAdminScope(user, c.post.schoolId);
      if (c.status === 'DELETED' || c.post.status !== 'PUBLISHED')
        throw new ConflictException('评论或帖子已变更');
      const status =
        dto.decision === 'APPROVE'
          ? 'PUBLISHED'
          : dto.decision === 'REJECT'
            ? 'REJECTED'
            : 'HIDDEN';
      await tx.comment.update({ where: { id }, data: { status, reason: dto.reason } });
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: 'COMMENT_' + dto.decision,
          targetId: id,
          detail: { reason: dto.reason },
        },
      });
      if (status === 'PUBLISHED' && c.status !== 'PUBLISHED') {
        const parent = c.parentId
          ? await tx.comment.findUnique({ where: { id: c.parentId } })
          : null;
        const recipients = new Set(
          [c.post.authorId, parent?.authorId].filter((v): v is string => !!v && v !== c.authorId),
        );
        for (const userId of recipients) {
          if (
            await tx.block.findUnique({
              where: { userId_blockedId: { userId, blockedId: c.authorId } },
            })
          )
            continue;
          const name = c.post.anonymous
            ? alias(c.postId, c.authorId)
            : (await tx.user.findUniqueOrThrow({ where: { id: c.authorId } })).nickname;
          await tx.outbox.create({
            data: {
              kind: 'NOTIFY',
              payload: {
                userId,
                title: '收到一条新回复',
                body: `${name} 回复了你参与的帖子`,
                postId: c.postId,
              },
            },
          });
        }
      }
      await tx.outbox.create({
        data: {
          kind: 'NOTIFY',
          payload: {
            userId: c.authorId,
            title: '评论审核结果',
            body: dto.reason,
            postId: c.postId,
          },
        },
      });
      return { ok: true };
    });
  }
  @Get('verifications') verifications(@CurrentUser() user: Actor) {
    return this.db.verification.findMany({
      where: { ...this.scope(user), status: 'PENDING', method: 'MANUAL' },
      select: {
        id: true,
        schoolId: true,
        school: { select: { name: true } },
        user: { select: { nickname: true } },
        materialId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }
  @Post('verifications/:id/review') async verify(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: VerifyReviewDto,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(sql`SELECT id FROM "Verification" WHERE id=${id} FOR UPDATE`);
      const request = await tx.verification.findUniqueOrThrow({ where: { id } });
      checkAdminScope(user, request.schoolId);
      if (request.status !== 'PENDING' || request.method !== 'MANUAL')
        throw new ConflictException('认证已被处理');
      const target = await tx.user.findUniqueOrThrow({ where: { id: request.userId } });
      if (target.deletedAt) throw new BadRequestException('用户已注销');
      await tx.verification.update({
        where: { id },
        data: {
          status: dto.approve ? 'APPROVED' : 'REJECTED',
          reason: dto.reason,
          reviewedAt: new Date(),
        },
      });
      if (dto.approve)
        await tx.membership.upsert({
          where: { userId_schoolId: { userId: request.userId, schoolId: request.schoolId } },
          create: {
            userId: request.userId,
            schoolId: request.schoolId,
            status: 'VERIFIED',
            expiresAt: new Date(Date.now() + 180 * 86400000),
          },
          update: { status: 'VERIFIED', expiresAt: new Date(Date.now() + 180 * 86400000) },
        });
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: 'VERIFICATION_REVIEW',
          targetId: id,
          detail: { approve: dto.approve, reason: dto.reason },
        },
      });
      await tx.outbox.create({
        data: {
          kind: 'NOTIFY',
          payload: {
            userId: request.userId,
            title: '校园认证结果',
            body: dto.approve ? '校园认证已通过，欢迎加入社区。' : dto.reason,
          },
        },
      });
      return { ok: true };
    });
  }
  @Get('reports') reports(@CurrentUser() user: Actor) {
    return this.db.report.findMany({
      where: { status: 'OPEN', post: this.scope(user) },
      select: {
        id: true,
        postId: true,
        commentId: true,
        reason: true,
        snapshot: true,
        createdAt: true,
        post: { select: { version: true, status: true, title: true, schoolId: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }
  @Post('reports/:id/resolve') async resolve(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: CommentReviewDto,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(sql`SELECT id FROM "Report" WHERE id=${id} FOR UPDATE`);
      const r = await tx.report.findUniqueOrThrow({ where: { id }, include: { post: true } });
      checkAdminScope(user, r.post.schoolId);
      if (r.status !== 'OPEN') throw new ConflictException('举报已处理');
      if (dto.decision === 'HIDE') {
        if (r.commentId)
          await tx.comment.updateMany({
            where: { id: r.commentId, status: { not: 'DELETED' } },
            data: { status: 'HIDDEN', reason: dto.reason },
          });
        else
          await tx.post.updateMany({
            where: { id: r.postId, status: { notIn: ['DELETED', 'DRAFT'] } },
            data: { status: 'HIDDEN', moderationReason: dto.reason },
          });
      }
      await tx.report.update({
        where: { id },
        data: { status: 'RESOLVED', resolution: dto.reason },
      });
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: 'REPORT_RESOLVE',
          targetId: id,
          detail: { decision: dto.decision, reason: dto.reason },
        },
      });
      await tx.outbox.create({
        data: {
          kind: 'NOTIFY',
          payload: { userId: r.userId, title: '你的举报或申诉已处理', body: dto.reason },
        },
      });
      return { ok: true };
    });
  }
  @Get('users') async users(@CurrentUser() user: Actor) {
    return this.db.user.findMany({
      where: {
        role: 'STUDENT',
        deletedAt: null,
        ...(user.role === 'SCHOOL_ADMIN'
          ? { memberships: { some: { schoolId: user.adminSchoolId || '__none__' } } }
          : {}),
      },
      select: {
        id: true,
        nickname: true,
        banned: true,
        createdAt: true,
        memberships: { select: { schoolId: true, status: true } },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
  }
  @Put('users/:id/ban') async ban(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: BanDto,
  ) {
    const target = await this.db.user.findUniqueOrThrow({
      where: { id },
      include: { memberships: true },
    });
    if (target.role !== 'STUDENT') throw new ForbiddenException('不能限制管理员');
    if (user.role !== 'PLATFORM_ADMIN')
      throw new ForbiddenException('全局账号限制由平台管理员处理');
    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { banned: dto.banned, sessionVersion: { increment: 1 } },
      });
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: 'USER_BAN',
          targetId: id,
          detail: { banned: dto.banned, reason: dto.reason },
        },
      });
    });
    return { ok: true };
  }
  @Post('schools') async school(@CurrentUser() user: Actor, @Body() dto: SchoolDto) {
    if (user.role !== 'PLATFORM_ADMIN') throw new ForbiddenException('需要平台权限');
    return this.db.$transaction(async (tx) => {
      const s = await tx.school.upsert({ where: { id: dto.id }, create: dto, update: dto });
      await tx.audit.create({
        data: { actorId: user.id, action: 'SCHOOL_CONFIG', targetId: s.id, detail: { ...dto } },
      });
      return s;
    });
  }
  @Post('campuses') async campus(@CurrentUser() user: Actor, @Body() dto: CampusDto) {
    checkAdminScope(user, dto.schoolId);
    const existing = await this.db.campus.findUnique({ where: { id: dto.id } });
    if (existing && existing.schoolId !== dto.schoolId)
      throw new BadRequestException('校区编号已使用');
    return this.db.campus.upsert({
      where: { id: dto.id },
      create: dto,
      update: { name: dto.name },
    });
  }
  @Get('audit') async audit(@CurrentUser() user: Actor) {
    if (user.role !== 'PLATFORM_ADMIN') throw new ForbiddenException('需要平台权限');
    return this.db.audit.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }
  @Get('jobs') async jobs(@CurrentUser() user: Actor) {
    if (user.role !== 'PLATFORM_ADMIN') throw new ForbiddenException('需要平台权限');
    return this.db.outbox.findMany({
      where: { status: { in: ['FAILED', 'PENDING', 'PROCESSING'] } },
      select: {
        id: true,
        kind: true,
        status: true,
        attempts: true,
        error: true,
        nextAttemptAt: true,
        createdAt: true,
      },
      take: 100,
    });
  }
  @Post('jobs/:id/retry') async retry(@CurrentUser() user: Actor, @Param('id') id: string) {
    if (user.role !== 'PLATFORM_ADMIN') throw new ForbiddenException('需要平台权限');
    await this.db.outbox.updateMany({
      where: { id, status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, error: '', nextAttemptAt: new Date() },
    });
    return { ok: true };
  }
  @Get('feedback') async feedback(@CurrentUser() user: Actor) {
    if (user.role !== 'PLATFORM_ADMIN') throw new ForbiddenException('需要平台权限');
    return this.db.feedback.findMany({
      where: { status: 'OPEN' },
      select: { id: true, content: true, createdAt: true },
      take: 100,
    });
  }
  @Get('deliveries') async deliveries(@CurrentUser() user: Actor) {
    if (user.role !== 'PLATFORM_ADMIN') throw new ForbiddenException('需要平台权限');
    return this.db.subscriptionDelivery.findMany({
      select: { id: true, status: true, platformCode: true, error: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Post('announcements') async announce(@CurrentUser() user: Actor, @Body() dto: PostDto) {
    checkAdminScope(user, dto.schoolId);
    const campus = await this.db.campus.findUnique({ where: { id: dto.campusId } });
    if (
      !campus ||
      campus.schoolId !== dto.schoolId ||
      dto.category !== 'GUIDE' ||
      dto.anonymous ||
      dto.mediaIds?.length
    )
      throw new BadRequestException('公告需选择有效校区和校园指南分类');
    if (dto.title.trim().length < 2 || dto.content.trim().length < 5)
      throw new BadRequestException('请填写完整公告');
    return this.db.$transaction(async (tx) => {
      const p = await tx.post.create({
        data: {
          schoolId: dto.schoolId,
          campusId: dto.campusId,
          category: 'GUIDE',
          title: dto.title.trim(),
          content: dto.content.trim(),
          authorId: user.id,
          status: 'PUBLISHED',
          requestKey: randomUUID(),
          requestHash: randomUUID(),
        },
      });
      await tx.audit.create({
        data: {
          actorId: user.id,
          action: 'ANNOUNCEMENT_PUBLISH',
          targetId: p.id,
          detail: { title: p.title },
        },
      });
      return { id: p.id };
    });
  }
  @Post('feedback/:id/resolve') async feedbackResolve(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    if (user.role !== 'PLATFORM_ADMIN') throw new ForbiddenException('需要平台权限');
    return this.db.$transaction(async (tx) => {
      const f = await tx.feedback.update({ where: { id }, data: { status: 'RESOLVED' } });
      await tx.outbox.create({
        data: {
          kind: 'NOTIFY',
          payload: { userId: f.userId, title: '意见反馈已处理', body: dto.reason },
        },
      });
      return { ok: true };
    });
  }
}
@Module({ controllers: [OperationsController], providers: [OperationsService] })
export class OperationsModule {}
