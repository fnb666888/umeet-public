import type {Kysely} from 'kysely';
import type {Database} from '../../database/database.types.js';
import type {RequestContext} from '../../../../../packages/contracts/src/index.js';
import {randomUUID} from 'node:crypto';
import {ForbiddenException,NotFoundException,ConflictException} from '@nestjs/common';
import {z} from 'zod';
import {requireMember} from '../identity/permissions.service.js';
import {AuditService} from '../audit/audit.service.js';
const ApplySchema=z.strictObject({name:z.string().trim().min(1).max(40),slug:z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),description:z.string().trim().min(1).max(1000)});
export const DEFAULT_COMMUNITIES=[['hollow','树洞'],['market','交易'],['resources','资源'],['questions','问答'],['activities','搭子与活动'],['campus','校园日常']] as const;
export class CommunitiesService{
 constructor(private readonly db:Kysely<Database>){}
 async seedDefaults():Promise<void>{
  await this.db.transaction().execute(async tx=>{
   for(const [order,[slug,name]]of DEFAULT_COMMUNITIES.entries()){
    const id='default-'+slug;
    await tx.insertInto('communities').values({id,slug,name,description:name+'社区',is_default:1,display_order:order}).onDuplicateKeyUpdate({slug}).execute();
    await tx.insertInto('wiki_spaces').values({id:'wiki-'+id,community_id:id}).onDuplicateKeyUpdate({community_id:id}).execute();
   }
  });
 }
 async list(){return this.db.selectFrom('communities').selectAll().orderBy('display_order').orderBy('id').execute();}
 async apply(ctx:RequestContext,input:{name:string;slug:string;description:string}):Promise<{id:string}>{
  const actor=requireMember(ctx),data=ApplySchema.parse(input),id=randomUUID();
  await this.db.insertInto('community_applications').values({id,applicant_id:actor.userId,...data,community_id:null}).execute();return {id};
 }
 async approve(ctx:RequestContext,id:string):Promise<{id:string}>{
  const actor=requireMember(ctx);
  if(!actor.platformRoles.some(r=>['owner','admin'].includes(r)))throw new ForbiddenException('PLATFORM_PERMISSION_REQUIRED');
  return this.db.transaction().execute(async tx=>{
   const application=await tx.selectFrom('community_applications').selectAll().where('id','=',id).forUpdate().executeTakeFirst();
   if(!application)throw new NotFoundException('APPLICATION_NOT_FOUND');
   if(application.state==='approved'&&application.community_id)return {id:application.community_id};
   if(application.state!=='pending')throw new ConflictException('APPLICATION_NOT_PENDING');
   const communityId=randomUUID();
   await tx.insertInto('communities').values({id:communityId,slug:application.slug,name:application.name,description:application.description}).execute();
   await tx.insertInto('community_roles').values({user_id:application.applicant_id,community_id:communityId,role:'owner'}).execute();
   await tx.insertInto('wiki_spaces').values({id:randomUUID(),community_id:communityId}).execute();
   await tx.updateTable('community_applications').set({state:'approved',community_id:communityId}).where('id','=',id).execute();
   await new AuditService().append(tx,{actorId:actor.userId,kind:'community.approved',targetId:communityId,reason:'Approved community application '+id});
   return {id:communityId};
  });
 }
 async invite(ctx:RequestContext,community:string,user:string):Promise<{id:string}>{
  const actor=requireMember(ctx);
  if(!await this.hasRole(actor.userId,community,'owner'))throw new ForbiddenException('COMMUNITY_OWNER_REQUIRED');
  const id=randomUUID();await this.db.insertInto('community_invitations').values({id,community_id:community,user_id:user}).execute();return {id};
 }
 async accept(ctx:RequestContext,id:string):Promise<void>{
  const actor=requireMember(ctx);
  await this.db.transaction().execute(async tx=>{
   const invite=await tx.selectFrom('community_invitations').selectAll().where('id','=',id).forUpdate().executeTakeFirst();
   if(!invite)throw new NotFoundException('INVITATION_NOT_FOUND');
   if(invite.user_id!==actor.userId)throw new ForbiddenException('INVITATION_NOT_YOURS');
   if(invite.state==='accepted')return;
   if(invite.state!=='pending')throw new ConflictException('INVITATION_NOT_PENDING');
   const role=await tx.selectFrom('community_roles').select('role').where('user_id','=',actor.userId).where('community_id','=',invite.community_id).executeTakeFirst();
   if(!role)await tx.insertInto('community_roles').values({user_id:actor.userId,community_id:invite.community_id,role:'moderator'}).execute();
   await tx.updateTable('community_invitations').set({state:'accepted'}).where('id','=',id).execute();
  });
 }
 async hasRole(user:string,community:string,role:string):Promise<boolean>{
  const result=await this.db.selectFrom('community_roles').select('role').where('user_id','=',user).where('community_id','=',community).executeTakeFirst();
  return !!result&&(result.role===role||result.role==='owner');
 }
}
