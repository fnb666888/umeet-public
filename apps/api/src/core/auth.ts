import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { Database } from './database';
import Redis from 'ioredis';
export type Actor = User;
export const Public = () => SetMetadata('public', true);
export const Admin = () => SetMetadata('admin', true);
export const CurrentUser = createParamDecorator(
  (_data, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as Actor,
);
export function signUser(user: User) {
  return jwt.sign({ sub: user.id, version: user.sessionVersion }, process.env.JWT_SECRET!, {
    expiresIn: '7d',
    issuer: 'umeet',
    audience: 'umeet-client',
  });
}
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private db: Database,
    private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const isPublic = this.reflector.getAllAndOverride('public', [ctx.getHandler(), ctx.getClass()]);
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET!, {
          issuer: 'umeet',
          audience: 'umeet-client',
        }) as jwt.JwtPayload;
        const user = await this.db.user.findUnique({ where: { id: payload.sub } });
        if (!user || user.banned || user.deletedAt || user.sessionVersion !== payload.version)
          throw new Error();
        req.user = user;
      } catch {
        throw new UnauthorizedException('登录已失效，请重新登录');
      }
    } else if (!isPublic) throw new UnauthorizedException('请先登录');
    if (
      this.reflector.getAllAndOverride('admin', [ctx.getHandler(), ctx.getClass()]) &&
      !['PLATFORM_ADMIN', 'SCHOOL_ADMIN'].includes(req.user?.role)
    )
      throw new ForbiddenException('需要管理员权限');
    return true;
  }
}
@Injectable()
export class RateGuard implements CanActivate {
  private buckets = new Map<string, { count: number; reset: number }>();
  private redis = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true })
    : null;
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const now = Date.now();
    if (this.buckets.size > 10000)
      for (const [key, value] of this.buckets) if (value.reset < now) this.buckets.delete(key);
    const key = `${req.ip}:${req.method}:${req.route?.path}`;
    let value = this.buckets.get(key);
    if (!value || value.reset < now) {
      value = { count: 0, reset: now + 60000 };
      this.buckets.set(key, value);
    }
    const limit = req.method === 'GET' ? 180 : /auth|email|contact/.test(req.path) ? 10 : 40;
    if (this.redis) {
      try {
        const count = Number(
          await this.redis.eval(
            'local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],60) end; return n',
            1,
            'umeet:rate:' + key,
          ),
        );
        if (count > limit) throw new HttpException('操作频繁，请稍后再试', 429);
        return true;
      } catch (e) {
        if (e instanceof HttpException) throw e;
        throw new HttpException('请求限流服务暂不可用', 503);
      }
    }
    if (++value.count > limit) throw new HttpException('操作频繁，请稍后再试', 429);
    return true;
  }
  onModuleDestroy() {
    this.redis?.disconnect();
  }
}
export async function requireMember(db: Database, user: Actor, schoolId: string) {
  const membership = await db.membership.findUnique({
    where: { userId_schoolId: { userId: user.id, schoolId } },
  });
  if (
    !membership ||
    membership.status !== 'VERIFIED' ||
    !membership.expiresAt ||
    membership.expiresAt < new Date()
  )
    throw new ForbiddenException('请先完成该学校的校园认证');
  return membership;
}
export function checkAdminScope(user: Actor, schoolId: string) {
  if (
    user.role !== 'PLATFORM_ADMIN' &&
    (user.role !== 'SCHOOL_ADMIN' || user.adminSchoolId !== schoolId)
  )
    throw new ForbiddenException('不能管理该学校');
}
