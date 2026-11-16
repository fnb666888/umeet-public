import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  Query,
  Inject,
  BadRequestException,
  NotFoundException,
  Header,
  ForbiddenException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import {
  KnowledgeRevisionSchema,
  KnowledgeDraftSchema,
  KnowledgeSearchSchema,
  KnowledgeDirectoryChangeSchema,
  KnowledgeRouteSchema,
  KnowledgeDisputeDecisionSchema,
} from '../../../../../packages/contracts/src/knowledge.js';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import { KnowledgeService } from './knowledge.service.js';
import { KnowledgeLinksService } from './knowledge-links.service.js';
import { KnowledgeDiffService } from './knowledge-diff.service.js';
type AuthRequest = {
  headers: { authorization?: string | string[]; 'x-knowledge-account'?: string | string[] };
};
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success)
    throw new BadRequestException({
      code: 'INVALID_INPUT',
      message: '请检查填写内容',
      issues: r.error.issues,
    });
  return r.data;
}
const reason = z.string().trim().min(1).max(4000);
@Controller('/api/v1/knowledge')
export class KnowledgeController {
  private readonly wiki: KnowledgeService;
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {
    this.wiki = new KnowledgeService(db);
  }
  private async context(req: AuthRequest): Promise<RequestContext> {
    const h = req.headers.authorization;
    const token = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : '';
    const actor = token ? await new PasswordAuthService(this.db).authenticate(token) : null;
    const expected = req.headers['x-knowledge-account'];
    if (expected && expected !== actor?.userId)
      throw new ForbiddenException({
        code: 'ACCOUNT_CHANGED',
        message: '账号已变化，请重新打开编辑页面。',
      });
    return { actor, requestId: 'knowledge' };
  }
  @Get('capabilities') async capabilities(
    @Req() req: AuthRequest,
    @Query('communityId') communityId?: string,
  ) {
    return this.wiki.access.capabilities(await this.context(req), communityId);
  }
  @Get('communities') communities() {
    return this.db
      .selectFrom('communities')
      .select(['id', 'slug', 'name'])
      .orderBy('display_order')
      .execute();
  }
  @Get('pages') @Header('Cache-Control', 'private, no-store') search(@Query() query: unknown) {
    return this.wiki.search(parse(KnowledgeSearchSchema, query));
  }
  @Post('pages') async create(@Req() req: AuthRequest) {
    return this.wiki.create(await this.context(req));
  }
  @Get('resolve') resolve(@Query('title') title: string) {
    return this.wiki.resolveTitle(parse(z.string().max(160), title));
  }
  @Get('pages/:id') @Header('Cache-Control', 'private, no-store') async read(
    @Param('id') id: string,
  ) {
    const p = await this.wiki.read(id);
    if (!p) throw new NotFoundException('KNOWLEDGE_UNAVAILABLE');
    return p;
  }
  @Get('pages/:id/history') @Header('Cache-Control', 'private, no-store') history(
    @Param('id') id: string,
  ) {
    return this.wiki.history(id);
  }
  @Get('pages/:id/revision') @Header('Cache-Control', 'private, no-store') async revision(
    @Param('id') id: string,
    @Query('revisionId') revisionId: string,
  ) {
    const r = await this.wiki.reader.revision(id, revisionId);
    if (!r) throw new NotFoundException('REVISION_NOT_FOUND');
    return r;
  }
  @Get('pages/:id/relations') @Header('Cache-Control', 'private, no-store') relations(
    @Param('id') id: string,
  ) {
    return this.wiki.relations(id);
  }
  @Get('pages/:id/backlinks') @Header('Cache-Control', 'private, no-store') backlinks(
    @Param('id') id: string,
  ) {
    return new KnowledgeLinksService(this.db).backlinks(id);
  }
  @Get('pages/:id/diff') @Header('Cache-Control', 'private, no-store') diff(
    @Param('id') id: string,
    @Query() raw: unknown,
  ) {
    const input = parse(
      z.strictObject({ fromId: z.string().min(1).max(64), toId: z.string().min(1).max(64) }),
      raw,
    );
    return new KnowledgeDiffService(this.db).diff(id, input.fromId, input.toId);
  }
  @Post('pages/:id/publish') async publish(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.wiki.publish(await this.context(req), id, parse(KnowledgeRevisionSchema, body));
  }
  @Post('pages/:id/submit') async submit(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.wiki.submit(await this.context(req), id, parse(KnowledgeRevisionSchema, body));
  }
  @Get('proposals') @Header('Cache-Control', 'private, no-store') async proposals(
    @Req() req: AuthRequest,
    @Query() raw: unknown,
  ) {
    const query = parse(
      z.strictObject({
        state: z.enum(['all', 'pending', 'returned', 'approved']).optional(),
        cursor: z.string().min(1).max(64).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(200),
      }),
      raw,
    );
    return this.wiki.proposals(await this.context(req), {
      ...(query.state ? { state: query.state } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
    });
  }
  @Post('proposals/:id/review') async review(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.wiki.review(
      await this.context(req),
      id,
      parse(
        z.strictObject({
          decision: z.enum(['approve', 'return']),
          reason: z.string().max(4000),
          expectedPublishedRevisionId: z.string().nullable(),
          idempotencyKey: z.string().min(8).max(100),
        }),
        body,
      ),
    );
  }
  @Get('proposals/:id') @Header('Cache-Control', 'private, no-store') async proposal(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    return this.wiki.publisher.proposal(await this.context(req), id);
  }
  @Post('pages/:id/rollback') async rollback(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = parse(
      z.strictObject({
        revisionId: z.string().min(1),
        baseRevisionId: z.string().min(1),
        idempotencyKey: z.string().min(8).max(100),
      }),
      body,
    );
    return this.wiki.publisher.rollback(
      await this.context(req),
      id,
      b.revisionId,
      b.baseRevisionId,
      b.idempotencyKey,
    );
  }
  @Get('drafts') @Header('Cache-Control', 'private, no-store') async drafts(
    @Req() req: AuthRequest,
  ) {
    return this.wiki.drafts.list(await this.context(req));
  }
  @Get('drafts/:task') @Header('Cache-Control', 'private, no-store') async draft(
    @Req() req: AuthRequest,
    @Param('task') task: string,
  ) {
    return { draft: await this.wiki.draft(await this.context(req), task) };
  }
  @Put('drafts') async saveDraft(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.wiki.saveDraft(await this.context(req), parse(KnowledgeDraftSchema, body));
  }
  @Delete('drafts/:task') async removeDraft(@Req() req: AuthRequest, @Param('task') task: string) {
    await this.wiki.drafts.remove(await this.context(req), task);
    return { ok: true };
  }
  @Get('communities/:slug') @Header('Cache-Control', 'private, no-store') community(
    @Param('slug') slug: string,
  ) {
    return this.wiki.community(slug);
  }
  @Put('communities/:id/directory') async directory(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.wiki.saveDirectory(
      await this.context(req),
      id,
      parse(KnowledgeDirectoryChangeSchema, body),
    );
  }
  @Post('communities/:id/suggestions') async suggest(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.wiki.suggestOrganization(
      await this.context(req),
      id,
      parse(
        z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('directory'), change: KnowledgeDirectoryChangeSchema }),
          z.strictObject({ kind: z.literal('route'), change: KnowledgeRouteSchema }),
        ]),
        body,
      ),
    );
  }
  @Get('communities/:id/suggestions')
  @Header('Cache-Control', 'private, no-store')
  async organizationSuggestions(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.wiki.organizations.list(await this.context(req), id);
  }
  @Post('suggestions/:id/review') async reviewSuggestion(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = parse(
      z.strictObject({ decision: z.enum(['approve', 'return']), reason: z.string().max(4000) }),
      body,
    );
    await this.wiki.reviewOrganization(await this.context(req), id, b.decision, b.reason);
    return { ok: true };
  }
  @Get('routes') @Header('Cache-Control', 'private, no-store') routes(
    @Query('communityId') communityId?: string,
  ) {
    return this.wiki.routes.list(communityId);
  }
  @Post('communities/:id/routes') async saveRoute(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.wiki.saveRoute(await this.context(req), id, parse(KnowledgeRouteSchema, body));
  }
  @Get('routes/:id') @Header('Cache-Control', 'private, no-store') async route(
    @Param('id') id: string,
  ) {
    const r = await this.wiki.route(id);
    if (!r) throw new NotFoundException('ROUTE_NOT_FOUND');
    return r;
  }
  @Post('routes/:id/confirm') async confirm(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = parse(
      z.strictObject({ stepId: z.string().min(1), revisionId: z.string().min(1) }),
      body,
    );
    await this.wiki.confirmStep(await this.context(req), id, b.stepId, b.revisionId);
    return { ok: true };
  }
  @Get('governance') @Header('Cache-Control', 'private, no-store') async management(
    @Req() req: AuthRequest,
  ) {
    return this.wiki.governance.management(await this.context(req));
  }
  @Post('pages/:id/disputes') async dispute(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.wiki.raiseDispute(
      await this.context(req),
      id,
      parse(z.strictObject({ reason }), body).reason,
    );
  }
  @Post('disputes/:id/decision') async decision(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.wiki.decideDispute(
      await this.context(req),
      id,
      parse(KnowledgeDisputeDecisionSchema, body),
    );
    return { ok: true };
  }
  @Post('pages/:id/review-publish') async reviewPublish(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = parse(z.strictObject({ revision: KnowledgeRevisionSchema, reason }), body);
    return this.wiki.publisher.reviewPublish(await this.context(req), id, b.revision, b.reason);
  }
  @Post('pages/:id/visibility') async visibility(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = parse(z.strictObject({ hidden: z.boolean(), reason }), body);
    await this.wiki.setVisibility(await this.context(req), id, b.hidden, b.reason);
    return { ok: true };
  }
  @Post('pages/:id/purge') async purge(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.wiki.purge(
      await this.context(req),
      id,
      parse(z.strictObject({ reason }), body).reason,
    );
    return { ok: true };
  }
  @Get('pages/:id/discussions') @Header('Cache-Control', 'private, no-store') discussions(
    @Param('id') id: string,
  ) {
    return this.wiki.discussions.list(id);
  }
  @Post('pages/:id/discussions') async discuss(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.wiki.discussions.add(
      await this.context(req),
      id,
      parse(z.strictObject({ body: z.string().trim().min(1).max(8000) }), body).body,
    );
  }
}
