import {
  Controller,
  Get,
  Post,
  Inject,
  Req,
  BadRequestException,
  Body,
  Param,
  Query,
  Res,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { requireMember } from '../identity/permissions.service.js';
import { DemoSnapshotsService } from './demo-snapshots.service.js';
import { Batch } from './demo.schema.js';
import { moderationAccess } from '../admin/scope.js';
import { activePenalties } from '../admin/restrictions.js';
import { SettingsService } from '../settings/settings.service.js';
import {readAsset} from './r2-assets.js';
import { publicBootstrap } from './public-bootstrap.js';
import { CommunityPages, PageQuery } from './community-pages.js';
type Request = { headers: { authorization?: string } };
@Controller('/api/v1/demo')
export class DemoController {
  private readonly auth: PasswordAuthService;
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    @Inject(DemoSnapshotsService) private readonly snapshots: DemoSnapshotsService,
  ) {
    this.auth = new PasswordAuthService(db);
  }
  private actor(req: Request) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    return token ? this.auth.authenticate(token, true).catch(error => {
      if (error instanceof UnauthorizedException) return null;
      throw error;
    }) : null;
  }
  @Get('site-settings') siteSettings() {
    return new SettingsService(this.db).getPublicSiteSettings();
  }
  @Get('bootstrap') bootstrap() { return publicBootstrap(this.db); }
  @Get('pages/feed') feed(@Req() req: Request, @Query() query: unknown) { return this.page(req,query); }
  @Get('pages/wiki-options') async wikiOptions(@Query('board') board:string,@Query('q') q=''){
    if(!/^[a-z0-9_-]{1,80}$/.test(board)||q.length>80)throw new BadRequestException('INVALID_INPUT');
    let read=this.db.selectFrom('demo_entities').select([
      sql<string>`JSON_UNQUOTE(JSON_EXTRACT(data,'$.id'))`.as('id'),
      sql<string>`JSON_UNQUOTE(JSON_EXTRACT(data,'$.title'))`.as('title'),
    ]).where('kind','=','wiki').where(sql<boolean>`JSON_CONTAINS(JSON_EXTRACT(data,'$.communities'),${JSON.stringify(board)})`)
      .where('id','not in',this.db.selectFrom('admin_visibility').select('target').where('hidden','=',1));
    if(q)read=read.where(sql<boolean>`LOCATE(${q},JSON_UNQUOTE(JSON_EXTRACT(data,'$.title'))) > 0`);
    return {items:await read.orderBy('id').limit(20).execute()};
  }
  @Get('pages/posts/:id') postPage(@Req() req: Request, @Query() query: unknown, @Param('id') id:string) { return this.page(req,query,id); }
  private async page(req: Request, raw: unknown, id?:string) {
    const query=PageQuery.safeParse(raw);
    if(!query.success)throw new BadRequestException('INVALID_INPUT');
    const actor=await this.actor(req);
    const penalties=actor?await activePenalties(this.db,actor.userId):[];
    if(penalties.some(p=>!p.board&&['suspension','deactivation'].includes(p.capability)))
      return {partial:true,suspended:true,actor:actor?{...actor,nickname:'账号使用受限',moderation:{admin:false,boards:[]}}:null,version:0,content:{posts:[],comments:{},wiki:[],notifications:[]},userState:{likes:[],commentLikes:[],best:{},threads:[]},contacts:[],profiles:[]};
    const [data,user,moderation]=await Promise.all([
      new CommunityPages(this.db).read(actor?.userId||null,query.data,id),
      actor?this.db.selectFrom('users').select('nickname').where('id','=',actor.userId).executeTakeFirst():null,
      actor?moderationAccess(this.db,actor.userId):null,
    ]);
    return {...data,actor:actor?{...actor,nickname:user?.nickname||actor.userId,moderation}:null};
  }
  @Get() async get(@Req() req: Request, @Query('messages') messages?: string) {
    const actor = await this.actor(req);
    const suspended =
      actor &&
      (await activePenalties(this.db, actor.userId)).some(
        (p) => ['suspension', 'deactivation'].includes(p.capability) && !p.board,
      );
    if (actor && suspended)
      return {
        version: 0,
        suspended: true,
        actor: {
          ...actor,
          nickname: '账号使用受限',
          platformRoles: [],
          moderation: { admin: false, boards: [] },
        },
        content: { posts: [], comments: {}, wiki: [], notifications: [] },
        profiles: [],
        contacts: [],
        userState: { likes: [], commentLikes: [], best: {}, threads: [] },
      };
    const [snapshot, user, moderation] = await Promise.all([
      this.snapshots.get(actor?.userId || null, messages !== 'omit'),
      actor
        ? this.db
            .selectFrom('users')
            .select('nickname')
            .where('id', '=', actor.userId)
            .executeTakeFirst()
        : undefined,
      actor ? moderationAccess(this.db, actor.userId) : null,
    ]);
    return {
      ...snapshot,
      actor: actor ? { ...actor, nickname: user?.nickname || actor.userId, moderation } : null,
    };
  }
  @Get('assets/:id') async asset(
    @Param('id') id: string,
    @Res() response: import('express').Response,
  ) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new NotFoundException('ASSET_NOT_FOUND');
    const asset = await this.db
      .selectFrom('demo_assets')
      .select('data')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!asset) throw new NotFoundException('ASSET_NOT_FOUND');
    if(asset.data==='r2:images/'+id){
      const object=await readAsset(id);
      response.set({'Content-Type':object.type,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=31536000, immutable'}).send(object.body);return;
    }
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(asset.data);
    if (!match) throw new NotFoundException('ASSET_NOT_FOUND');
    response
      .set({
        'Content-Type': match[1]!,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
      })
      .send(Buffer.from(match[2]!, 'base64'));
  }
  @Post('operations') async save(@Req() req: Request, @Body() body: unknown, @Query('messages') messages?: string, @Query('projection') projection?:string) {
    const actor = requireMember({ actor: await this.actor(req), requestId: 'demo' });
    const input = Batch.safeParse(body);
    if (!input.success) throw new BadRequestException('INVALID_INPUT');
    // Page mutations acknowledge the write; the active resource revalidates its
    // own projection. Compatibility clients still receive the full snapshot.
    if(projection==='page'){
      await this.snapshots.save(actor.userId,input.data,messages!=='omit',false);
      return {ok:true};
    }
    const result = await this.snapshots.save(actor.userId, input.data, messages !== 'omit');
    const user = await this.db
      .selectFrom('users')
      .select('nickname')
      .where('id', '=', actor.userId)
      .executeTakeFirst();
    return { ...result, actor: { ...actor, nickname: user?.nickname || actor.userId, moderation: await moderationAccess(this.db, actor.userId) } };
  }
}
