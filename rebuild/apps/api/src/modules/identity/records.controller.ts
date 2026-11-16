import {Controller,Get,Put,Delete,Param,Query,Body,Req,Inject,BadRequestException} from '@nestjs/common';
import type {Kysely} from 'kysely';
import {z} from 'zod';
import type {Database} from '../../database/database.types.js';
import {PersonalRecordKindSchema,PersonalRecordKeySchema} from '../../../../../packages/contracts/src/index.js';
import {DATABASE} from './auth.controller.js';
import {PasswordAuthService} from './password-auth.service.js';
import {IdentityService} from './identity.service.js';
type AuthRequest={headers:{authorization?:string|string[]}};
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new BadRequestException('INVALID_INPUT');return result.data;}
@Controller('/api/v1/records')
export class RecordsController{
 constructor(@Inject(DATABASE)private readonly db:Kysely<Database>){}
 private actor(req:AuthRequest){const header=req.headers.authorization;return new PasswordAuthService(this.db).authenticate(typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):'');}
 @Get()async list(@Query()query:unknown,@Req()req:AuthRequest){const actor=await this.actor(req);const input=parse(z.strictObject({kind:PersonalRecordKindSchema.default('draft'),after:PersonalRecordKeySchema.optional()}),query);return new IdentityService(this.db).listPersonalRecords(actor,input.kind,input.after);}
 @Put(':kind/:key')async save(@Param('kind')kind:string,@Param('key')key:string,@Body()body:unknown,@Req()req:AuthRequest){const actor=await this.actor(req);parse(PersonalRecordKindSchema,kind);parse(PersonalRecordKeySchema,key);const input=parse(z.strictObject({value:z.string().max(500000)}),body);await new IdentityService(this.db).savePersonalRecord(actor,kind,key,input.value);return {ok:true};}
 @Delete(':kind/:key')async remove(@Param('kind')kind:string,@Param('key')key:string,@Req()req:AuthRequest){const actor=await this.actor(req);parse(PersonalRecordKindSchema,kind);parse(PersonalRecordKeySchema,key);await new IdentityService(this.db).deletePersonalRecord(actor,kind,key);return {ok:true};}
}
