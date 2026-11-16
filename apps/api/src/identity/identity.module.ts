import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Module,
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
  Logger,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { randomInt, createHash, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { Database } from '../core/database';
import { Public, Actor, CurrentUser, signUser } from '../core/auth';
import {
  AdminLoginDto,
  WechatLoginDto,
  DemoLoginDto,
  ProfileDto,
  VerifyDto,
  VerifyEmailDto,
  VerifyCodeDto,
  ReasonDto,
  ConsentDto,
} from '../core/dto';
import { demoMode } from '../core/config';
import { emailDomains, sql } from '../core/database-dialect';

@Injectable()
export class WechatService {
  private token = { value: '', expires: 0 };
  async accessToken() {
    if (this.token.expires > Date.now()) return this.token.value;
    if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET)
      throw new BadRequestException('微信能力尚未配置');
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.search = new URLSearchParams({
      grant_type: 'client_credential',
      appid: process.env.WECHAT_APP_ID,
      secret: process.env.WECHAT_APP_SECRET,
    }).toString();
    const data = (await (await fetch(url, { signal: AbortSignal.timeout(10000) })).json()) as any;
    if (!data.access_token) throw new BadRequestException('微信服务暂时不可用');
    this.token = { value: data.access_token, expires: Date.now() + (data.expires_in - 300) * 1000 };
    return this.token.value;
  }
  async textCheck(content: string, openid: string) {
    if (demoMode()) return { suggest: 'review', label: 0 };
    const token = await this.accessToken();
    const result = (await (
      await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 2, scene: 2, openid, content }),
        signal: AbortSignal.timeout(12000),
      })
    ).json()) as any;
    if (result.errcode) throw new Error('文字审核依赖失败');
    return result.result as { suggest: string; label: number };
  }
}

@ApiTags('identity')
@ApiBearerAuth()
@Controller()
class IdentityController {
  constructor(private db: Database) {}
  @Public()
  @Post('auth/wechat')
  async wechat(@Body() dto: WechatLoginDto) {
    if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET)
      throw new BadRequestException('请先配置微信 AppID 与 AppSecret');
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({
      appid: process.env.WECHAT_APP_ID,
      secret: process.env.WECHAT_APP_SECRET,
      js_code: dto.code,
      grant_type: 'authorization_code',
    }).toString();
    let data: { openid?: string; errcode?: number };
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Wechat upstream HTTP failure');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object') throw new Error('Wechat response invalid');
      const fields = body as Record<string, unknown>;
      data = {
        openid: typeof fields.openid === 'string' ? fields.openid : undefined,
        errcode: typeof fields.errcode === 'number' ? fields.errcode : undefined,
      };
    } catch (error: unknown) {
      // Log only a bounded transport code, never URLs, secrets or login codes.
      const cause = error instanceof Error ? error.cause : undefined;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
      new Logger('WechatLogin').error(typeof code === 'string' && /^[A-Z_0-9]{1,80}$/.test(code) ? code : 'UPSTREAM_REQUEST_FAILED');
      throw new ServiceUnavailableException('微信登录服务连接失败，请稍后重试');
    }
    if (data.errcode && [40013, 40125, 40164].includes(data.errcode)) {
      new Logger('WechatLogin').error(`UPSTREAM_CONFIG_${data.errcode}`);
      throw new ServiceUnavailableException('微信登录配置异常，请联系管理员');
    }
    if (!data.openid || data.errcode) throw new UnauthorizedException('微信登录凭证无效，请重新登录');
    const user = await this.db.user.upsert({
      where: { openid: data.openid },
      create: { openid: data.openid, nickname: '新同学' },
      update: {},
    });
    if (user.banned || user.deletedAt) throw new ForbiddenException('账号不可用');
    return { token: signUser(user) };
  }
  @Public()
  @Post('auth/demo')
  async demo(@Body() dto: DemoLoginDto) {
    if (!demoMode()) throw new ForbiddenException('演示登录未开启');
    const ids: Record<string, string> = {
      student: 'demo-student',
      peer: 'demo-peer',
      other: 'demo-other',
      admin: 'platform-admin',
      unverified: 'demo-unverified',
    };
    const user = await this.db.user.upsert({
      where: { id: ids[dto.role] },
      create: { id: ids[dto.role], nickname: '待认证同学' },
      update: {},
    });
    if (user.banned || user.deletedAt) throw new ForbiddenException('账号不可用');
    return { token: signUser(user) };
  }
  @Public()
  @Post('auth/admin')
  async admin(@Body() dto: AdminLoginDto) {
    const actual = createHash('sha256').update(dto.password).digest();
    const expected = createHash('sha256').update(process.env.ADMIN_PASSWORD!).digest();
    if (!timingSafeEqual(actual, expected)) throw new UnauthorizedException('密码错误');
    const user = await this.db.user.findUniqueOrThrow({ where: { id: 'platform-admin' } });
    if (user.banned || user.deletedAt) throw new ForbiddenException('账号不可用');
    return { token: signUser(user) };
  }
  @Get('me')
  async me(@CurrentUser() user: Actor) {
    const memberships = await this.db.membership.findMany({
      where: { userId: user.id },
      include: { school: { select: { id: true, name: true } } },
    });
    return {
      id: user.id,
      nickname: user.nickname,
      role: user.role,
      memberships: memberships.map((m) => ({
        schoolId: m.schoolId,
        school: m.school,
        status: m.expiresAt && m.expiresAt > new Date() ? m.status : 'EXPIRED',
        expiresAt: m.expiresAt,
      })),
      demo: demoMode(),
    };
  }
  @Put('me') async profile(@CurrentUser() user: Actor, @Body() dto: ProfileDto) {
    await this.db.user.update({ where: { id: user.id }, data: { nickname: dto.nickname.trim() } });
    return { ok: true };
  }
  @Post('auth/logout') async logout(@CurrentUser() user: Actor) {
    await this.db.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    return { ok: true };
  }
  @Delete('me')
  async deleteAccount(@CurrentUser() user: Actor) {
    if (user.role !== 'STUDENT') throw new ForbiddenException('管理员账号需由平台管理');
    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          nickname: '已注销用户',
          avatar: '',
          deletedAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      });
      await tx.post.updateMany({
        where: { authorId: user.id },
        data: { status: 'DELETED', contact: null },
      });
      await tx.comment.updateMany({ where: { authorId: user.id }, data: { status: 'DELETED' } });
      await tx.membership.updateMany({ where: { userId: user.id }, data: { status: 'REVOKED' } });
      await tx.verification.updateMany({
        where: { userId: user.id },
        data: { email: null, codeHash: null, materialId: null, status: 'WITHDRAWN' },
      });
    });
    return { ok: true };
  }
  @Get('me/verifications') async requests(@CurrentUser() user: Actor) {
    return this.db.verification.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        schoolId: true,
        method: true,
        status: true,
        reason: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
  @Post('verifications/manual')
  async verify(@CurrentUser() user: Actor, @Body() dto: VerifyDto) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(sql`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`);
      await tx.$queryRaw(sql`SELECT id FROM "Media" WHERE id=${dto.materialId} FOR UPDATE`);
      const media = await tx.media.findUnique({ where: { id: dto.materialId } });
      if (!media || media.userId !== user.id || media.purpose !== 'VERIFICATION')
        throw new BadRequestException('认证材料无效');
      if (!(await tx.school.findUnique({ where: { id: dto.schoolId } })))
        throw new BadRequestException('学校不存在');
      if (
        await tx.verification.count({
          where: { userId: user.id, schoolId: dto.schoolId, status: 'PENDING' },
        })
      )
        throw new BadRequestException('已有待处理认证');
      return tx.verification.create({
        data: { userId: user.id, schoolId: dto.schoolId, method: 'MANUAL', materialId: media.id },
        select: { id: true, status: true },
      });
    });
  }
  @Post('verifications/email')
  async email(@CurrentUser() user: Actor, @Body() dto: VerifyEmailDto) {
    const school = await this.db.school.findUnique({ where: { id: dto.schoolId } });
    const email = dto.email.toLowerCase().trim();
    if (!school || !emailDomains(school.emailDomains).includes(email.split('@')[1]))
      throw new BadRequestException('邮箱域名不在学校认证范围内');
    if (!process.env.SMTP_HOST) throw new BadRequestException('邮箱认证尚未启用，请使用材料审核');
    if (
      await this.db.verification.count({
        where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60000) } },
      })
    )
      throw new BadRequestException('请一分钟后再申请');
    const code = String(randomInt(100000, 1000000));
    const request = await this.db.verification.create({
      data: {
        userId: user.id,
        schoolId: school.id,
        method: 'EMAIL',
        email,
        codeHash: createHash('sha256')
          .update(code + process.env.JWT_SECRET)
          .digest('hex'),
        codeExpiresAt: new Date(Date.now() + 10 * 60000),
      },
    });
    try {
      await nodemailer
        .createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 465),
          secure: process.env.SMTP_PORT !== '587',
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
        })
        .sendMail({
          from: process.env.SMTP_FROM,
          to: email,
          subject: 'Umeet 校园认证验证码',
          text: `验证码为 ${code}，10 分钟内有效。如非本人申请，请忽略。`,
        });
    } catch {
      await this.db.verification.update({
        where: { id: request.id },
        data: { status: 'FAILED', codeHash: null },
      });
      throw new BadRequestException('邮件发送失败，请稍后重试');
    }
    return { id: request.id };
  }
  @Post('verifications/email/confirm')
  async confirm(@CurrentUser() user: Actor, @Body() dto: VerifyCodeDto) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(sql`SELECT id FROM "Verification" WHERE id=${dto.id} FOR UPDATE`);
      const request = await tx.verification.findUnique({ where: { id: dto.id } });
      if (
        !request ||
        request.userId !== user.id ||
        request.method !== 'EMAIL' ||
        request.status !== 'PENDING' ||
        !request.codeExpiresAt ||
        request.codeExpiresAt < new Date() ||
        request.attempts >= 5
      )
        throw new BadRequestException('验证码已失效');
      const hash = createHash('sha256')
        .update(dto.code + process.env.JWT_SECRET)
        .digest('hex');
      if (request.codeHash !== hash) {
        await tx.verification.update({
          where: { id: request.id },
          data: { attempts: { increment: 1 } },
        });
        return { ok: false, message: '验证码错误' };
      }
      await tx.verification.update({
        where: { id: request.id },
        data: { status: 'APPROVED', codeHash: null, reviewedAt: new Date() },
      });
      await tx.membership.upsert({
        where: { userId_schoolId: { userId: user.id, schoolId: request.schoolId } },
        create: {
          userId: user.id,
          schoolId: request.schoolId,
          status: 'VERIFIED',
          expiresAt: new Date(Date.now() + 180 * 86400000),
        },
        update: { status: 'VERIFIED', expiresAt: new Date(Date.now() + 180 * 86400000) },
      });
      return { ok: true };
    });
  }
  @Post('feedback') async feedback(@CurrentUser() user: Actor, @Body() dto: ReasonDto) {
    return this.db.feedback.create({
      data: { userId: user.id, content: dto.reason },
      select: { id: true },
    });
  }
  @Post('notifications/consent') async consent(
    @CurrentUser() user: Actor,
    @Body() dto: ConsentDto,
  ) {
    if (dto.templateId !== process.env.WECHAT_SUBSCRIBE_TEMPLATE)
      throw new BadRequestException('订阅模板无效');
    await this.db.consent.create({
      data: { userId: user.id, templateId: dto.templateId, state: dto.state },
    });
    return { ok: true };
  }
  @Get('notifications') async notifications(@CurrentUser() user: Actor) {
    return this.db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Post('notifications/read-all') async readAll(@CurrentUser() user: Actor) {
    await this.db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
  @Post('notifications/:id/read') async read(@CurrentUser() user: Actor, @Param('id') id: string) {
    await this.db.notification.updateMany({
      where: { id, userId: user.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
@Module({ controllers: [IdentityController], providers: [WechatService], exports: [WechatService] })
export class IdentityModule {}
