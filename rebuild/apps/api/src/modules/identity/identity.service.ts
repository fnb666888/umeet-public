import { generateUsername } from './username.js';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import {PersonalRecordKindSchema as RecordKind,PersonalRecordKeySchema as RecordKey,type Actor,type PersonalRecordDto} from '../../../../../packages/contracts/src/index.js';
import {UnauthorizedException} from '@nestjs/common';
import type { VerifiedIdentity } from './auth-provider.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
const IdentitySchema=z.strictObject({provider:z.string().min(1).max(80),subject:z.string().min(1).max(200),kind:z.enum(['guest','member'])});
export class IdentityService{
 constructor(private readonly db:Kysely<Database>){}
 async resolve(verified:VerifiedIdentity):Promise<Actor>{
  const identity=IdentitySchema.parse(verified);
  for(let attempt=0;attempt<3;attempt++){
   try{
    return await this.db.transaction().execute(async tx=>{
     const existing=await tx.selectFrom('external_identities').select('user_id').where('provider','=',identity.provider).where('subject','=',identity.subject).executeTakeFirst();
     const userId=existing?.user_id||randomUUID();
     if(!existing){
      const handle = identity.kind === 'member' ? await generateUsername(tx) : null;
      await tx.insertInto('users').values({id:userId,nickname:handle || '新朋友',kind:identity.kind,handle,onboarded_at:handle ? new Date() : null}).execute();
      await tx.insertInto('external_identities').values({provider:identity.provider,subject:identity.subject,user_id:userId}).execute();
     }
     const user=await tx.selectFrom('users').selectAll().where('id','=',userId).forUpdate().executeTakeFirstOrThrow();
     if(user.deleted_at)throw new UnauthorizedException('AUTH_REQUIRED');
     if(user.merged_into)throw new UnauthorizedException('GUEST_ALREADY_MERGED');
     const kind=user.kind==='member'||identity.kind==='member'?'member':'guest';
     if(kind!==user.kind){
      const handle = user.handle || await generateUsername(tx);
      await tx.updateTable('users').set({kind,handle,nickname:handle,onboarded_at:new Date()}).where('id','=',userId).execute();
      await new AuditService().append(tx,{actorId:userId,kind:'identity.upgraded',targetId:userId,reason:'Verified registered identity replaced anonymous state'});
     }
     const roles=await tx.selectFrom('platform_roles').select('role').where('user_id','=',userId).execute();
     return {userId,kind,platformRoles:roles.map(r=>r.role)};
    });
   }catch(error){
    const code=error!==null&&typeof error==='object'&&'code'in error?String(error.code):'';
    if(attempt===2||!['ER_DUP_ENTRY','ER_LOCK_DEADLOCK'].includes(code))throw error;
   }
  }
  throw new Error('IDENTITY_RETRY_EXHAUSTED');
 }
 async savePersonalRecord(actor:Actor,kind:string,key:string,value:string):Promise<void>{
  RecordKind.parse(kind);RecordKey.parse(key);z.string().max(500000).parse(value);
  await this.db.transaction().execute(async tx=>{
   const user=await tx.selectFrom('users').select(['merged_into', 'deleted_at']).where('id','=',actor.userId).forUpdate().executeTakeFirstOrThrow();
   if(user.deleted_at)throw new UnauthorizedException('AUTH_REQUIRED');
     if(user.merged_into)throw new UnauthorizedException('GUEST_ALREADY_MERGED');
   await tx.insertInto('personal_records').values({user_id:actor.userId,kind,record_key:key,value}).onDuplicateKeyUpdate({value,updated_at:new Date()}).execute();
  });
 }
 async readPersonalRecord(actor:Actor,kind:string,key:string):Promise<string|null>{
  RecordKind.parse(kind);RecordKey.parse(key);
  const row=await this.db.selectFrom('personal_records').select('value').where('user_id','=',actor.userId).where('kind','=',kind).where('record_key','=',key).executeTakeFirst();
  return row?.value??null;
 }
 async listPersonalRecords(actor:Actor,kind:'draft'|'bookmark'|'history',after?:string):Promise<{items:PersonalRecordDto[];nextCursor:string|null}>{
  let query=this.db.selectFrom('personal_records').selectAll().where('user_id','=',actor.userId).where('kind','=',kind);
  if(after)query=query.where('record_key','>',after);
  const rows=await query.orderBy('record_key','asc').limit(51).execute();
  const page=rows.slice(0,50);
  return {items:page.map(row=>({kind:RecordKind.parse(row.kind),key:row.record_key,value:row.value,updatedAt:row.updated_at.toISOString()})),nextCursor:rows.length>50?page.at(-1)?.record_key??null:null};
 }
 async deletePersonalRecord(actor:Actor,kind:string,key:string):Promise<void>{
  RecordKind.parse(kind);RecordKey.parse(key);
  await this.db.deleteFrom('personal_records').where('user_id','=',actor.userId).where('kind','=',kind).where('record_key','=',key).execute();
 }
}
