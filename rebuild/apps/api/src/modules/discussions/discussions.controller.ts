import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import {
  CommentInputSchema,
  CommunitySlug,
  DiscussionId,
  DiscussionReason,
  PostInputSchema,
  VoteSchema,
} from '../../../../../packages/contracts/src/discussions.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { requireMember } from '../identity/permissions.service.js';
import { DiscussionsService } from './discussions.service.js';

type Request = { headers: { authorization?: string } };
const feedQuery = z.strictObject({
  community: CommunitySlug.optional(),
  after: DiscussionId.optional(),
  q: z.string().trim().min(1).max(80).optional(),
});
const reviewInput = z.strictObject({
  kind: z.enum(['post', 'comment']),
  decision: z.enum(['publish', 'hide']),
  reason: DiscussionReason,
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('INVALID_INPUT');
  return result.data;
}

@Controller('/api/v1/discussions')
export class DiscussionsController {
  private readonly discussions: DiscussionsService;
  private readonly auth: PasswordAuthService;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.discussions = new DiscussionsService(db);
    this.auth = new PasswordAuthService(db);
  }

  private actor(req: Request) {
    const value = req.headers.authorization;
    return this.auth.optionalActor(value?.startsWith('Bearer ') ? value.slice(7) : undefined);
  }

  private async member(req: Request) {
    return requireMember({ actor: await this.actor(req), requestId: 'discussions' });
  }

  @Get() list(@Query() query: unknown) {
    const { community, after, q } = parse(feedQuery, query);
    return this.discussions.list(community, after, q);
  }

  @Get('review') async reviewQueue(@Req() req: Request) {
    return this.discussions.reviewQueue(await this.member(req));
  }

  @Post('review/:id') async review(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(reviewInput, body);
    return this.discussions.review(
      await this.member(req),
      input.kind,
      parse(DiscussionId, id),
      input.decision,
      input.reason,
    );
  }

  @Get(':id') async detail(@Req() req: Request, @Param('id') id: string) {
    return this.discussions.detail(parse(DiscussionId, id), await this.actor(req));
  }

  @Post() async create(@Req() req: Request, @Body() body: unknown) {
    return this.discussions.create(await this.member(req), parse(PostInputSchema, body));
  }

  @Post(':id/comments') async comment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.discussions.comment(
      await this.member(req),
      parse(DiscussionId, id),
      parse(CommentInputSchema, body),
    );
  }

  @Put(':id/vote') async vote(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.discussions.vote(
      await this.member(req),
      parse(DiscussionId, id),
      parse(VoteSchema, body).value,
    );
  }

  @Post(':id/report') async report(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.discussions.report(
      await this.member(req),
      parse(DiscussionId, id),
      parse(z.strictObject({ reason: DiscussionReason }), body).reason,
    );
  }
}
