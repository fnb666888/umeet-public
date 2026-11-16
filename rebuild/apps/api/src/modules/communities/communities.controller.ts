import {BadRequestException,Controller,Get,Inject,Param,Query,NotFoundException} from '@nestjs/common';
import {sql,type Kysely} from 'kysely';
import type {Database} from '../../database/database.types.js';
import {DATABASE} from '../identity/auth.controller.js';
import {CommunitiesService} from './communities.service.js';
@Controller('/api/v1/communities')
export class CommunitiesController{
 constructor(@Inject(DATABASE)private readonly db:Kysely<Database>){}
 @Get()list(){return new CommunitiesService(this.db).list();}
 @Get('wiki/search') async searchWiki(@Query('q') input: unknown) {
  if (input !== undefined && (typeof input !== 'string' || input.length > 80)) throw new BadRequestException('INVALID_INPUT');
  const term = typeof input === 'string' ? input.trim() : '';
  let query = this.db.selectFrom('wiki_pages as p')
   .innerJoin('wiki_revisions as r', 'r.id', 'p.current_revision_id')
   .innerJoin('communities as c', 'c.id', 'p.community_id')
   .select(['p.id as pageId', 'r.title', 'c.slug as communitySlug'])
   .where('r.visibility', '=', 'public');
  if (term) query = query.where(sql<boolean>`(locate(lower(${term}), lower(r.title)) > 0 or locate(lower(${term}), lower(r.markdown)) > 0)`);
  return query.orderBy('r.created_at', 'desc').orderBy('p.id', 'desc').limit(30).execute();
 }
 @Get(':slug/wiki')async wiki(@Param('slug')slug:string){
  const community=await this.db.selectFrom('communities').select('id').where('slug','=',slug).executeTakeFirst();if(!community)throw new NotFoundException('COMMUNITY_NOT_FOUND');
  return this.db.selectFrom('wiki_pages').innerJoin('wiki_revisions','wiki_revisions.id','wiki_pages.current_revision_id').select(['wiki_pages.id','wiki_pages.slug','wiki_revisions.title','wiki_revisions.created_at']).where('wiki_pages.community_id','=',community.id).where('visibility','=','public').orderBy('wiki_revisions.created_at','desc').limit(100).execute();
 }
}
