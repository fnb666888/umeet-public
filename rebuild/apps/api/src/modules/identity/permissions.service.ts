import type { Actor,RequestContext } from '../../../../../packages/contracts/src/index.js';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
export function requireMember(ctx:RequestContext):Actor{
 if(!ctx.actor)throw new UnauthorizedException('AUTH_REQUIRED');
 if(ctx.actor.kind!=='member')throw new ForbiddenException('REGISTERED_ACCOUNT_REQUIRED');
 return ctx.actor;
}
export function requirePlatformAdmin(ctx:RequestContext):Actor{
 const actor=requireMember(ctx);
 if(!actor.platformRoles.some(r=>r==='owner'||r==='admin'))throw new ForbiddenException('PLATFORM_PERMISSION_REQUIRED');
 return actor;
}
