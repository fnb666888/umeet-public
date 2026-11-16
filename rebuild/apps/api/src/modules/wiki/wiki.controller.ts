import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Req,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { WikiService } from './wiki.service.js';
import {
  SaveRevisionSchema,
  type RequestContext,
} from '../../../../../packages/contracts/src/index.js';
import { randomUUID } from 'node:crypto';
import { WikiLinksService } from './wiki-links.service.js';
import { WikiDiffService } from './wiki-diff.service.js';
import { Query } from '@nestjs/common';
type AuthRequest = { headers: { authorization?: string | string[] } };
@Controller('/api/v1/wiki')
export class WikiController {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}
  private async context(req: AuthRequest): Promise<RequestContext> {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    return {
      actor: await new PasswordAuthService(this.db).authenticate(token),
      requestId: randomUUID(),
    };
  }
  @Get('resolve/:community/:slug') resolve(
    @Param('community') community: string,
    @Param('slug') slug: string,
  ) {
    return new WikiService(this.db).resolve(community, slug);
  }
  @Get(':id/meta') metadata(@Param('id') id: string) {
    return new WikiService(this.db).metadata(id);
  }
  @Get(':id/backlinks') backlinks(@Param('id') id: string) {
    return new WikiLinksService(this.db).listBacklinks(id);
  }
  @Get(':id/diff') diff(@Param('id') id: string, @Query() query: unknown) {
    const parsed = z
      .strictObject({ fromId: z.string().min(1), toId: z.string().min(1) })
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException('INVALID_INPUT');
    return new WikiDiffService(this.db).getRevisionDiff(parsed.data.fromId, parsed.data.toId, id);
  }
  @Get(':id/history') history(@Param('id') id: string) {
    return new WikiService(this.db).history(id);
  }
  @Get(':id') async read(@Param('id') id: string) {
    const page = await new WikiService(this.db).read(id);
    if (!page) throw new NotFoundException('WIKI_PAGE_NOT_FOUND');
    return page;
  }
  @Post() async create(@Body() body: unknown, @Req() req: AuthRequest) {
    const parsed = z
      .strictObject({
        communityId: z.string().min(1),
        slug: z.string().min(1).max(160),
        initialRevision: SaveRevisionSchema.optional(),
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException('INVALID_INPUT');
    const ctx = await this.context(req);
    const wiki = new WikiService(this.db);
    return parsed.data.initialRevision
      ? wiki.publishNew(ctx, parsed.data.communityId, parsed.data.slug, parsed.data.initialRevision)
      : wiki.createPage(ctx, parsed.data.communityId, parsed.data.slug);
  }
  @Put(':id') async save(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthRequest) {
    const parsed = SaveRevisionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('INVALID_INPUT');
    return new WikiService(this.db).saveRevision(await this.context(req), id, parsed.data);
  }
  @Post(':id/rollback') async rollback(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const parsed = z
      .strictObject({
        targetRevisionId: z.string().min(1),
        baseRevisionId: z.string().min(1),
        idempotencyKey: z.string().min(8).max(100),
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException('INVALID_INPUT');
    return new WikiService(this.db).rollback(await this.context(req), id, parsed.data);
  }
}
