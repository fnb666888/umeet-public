import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { PasswordAuthService } from '../identity/password-auth.service.js';
import { DemoSnapshotsService } from '../demo/demo-snapshots.service.js';
import { Batch } from '../demo/demo.schema.js';
import { requireMember } from '../identity/permissions.service.js';
import { activePenalties, requireCapability } from '../admin/restrictions.js';
import { SettingsService } from '../settings/settings.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { KnowledgeSearchSchema } from '../../../../../packages/contracts/src/knowledge.js';
import {
  renderMobileMarkdown,
  renderMobileHtml,
  postHtmlToMarkdown,
  markdownPostHtml,
} from './mobile-markdown.js';
type Request = { headers: { authorization?: string } };
const paging = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
  q: z.string().max(100).default(''),
  board: z.string().max(80).optional(),
  author: z.string().max(64).optional(),
  sort: z.enum(['latest', 'hot']).default('latest'),
  view: z.enum(['all', 'bookmarks', 'posts', 'replies']).default('all'),
});
@Controller('/api/v1/mobile')
export class MobileController {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    @Inject(DemoSnapshotsService) private readonly snapshots: DemoSnapshotsService,
  ) {}
  private async actor(req: Request) {
    const h = req.headers.authorization;
    return h
      ? new PasswordAuthService(this.db).authenticate(
          h.startsWith('Bearer ') ? h.slice(7) : '',
          true,
        )
      : null;
  }
  private async snapshot(req: Request) {
    const actor = await this.actor(req);
    if (actor) await requireCapability(this.db, actor.userId, 'suspension');
    return { actor, s: await this.snapshots.get(actor?.userId ?? null, false) };
  }
  private page<T extends { id: string }>(items: T[], limit: number, cursor?: string) {
    const at = cursor ? items.findIndex((i) => i.id === cursor) : -1;
    if (cursor && at < 0) throw new BadRequestException('CURSOR_EXPIRED');
    const list = items.slice(at + 1, at + 1 + limit);
    return { items: list, next: at + 1 + limit < items.length ? (list.at(-1)?.id ?? null) : null };
  }
  @Get('knowledge-feed') async knowledgeFeed(@Req() req: Request, @Query() raw: unknown) {
    await this.actor(req);
    const p = KnowledgeSearchSchema.safeParse(raw);
    if (!p.success) throw new BadRequestException('INVALID_QUERY');
    const r = await new KnowledgeService(this.db).search(p.data);
    return {
      items: r.items.map((p) => ({
        id: p.id,
        title: p.title,
        summary: p.summary,
        createdAt: p.createdAt,
      })),
      nextCursor: r.nextCursor,
    };
  }
  @Post('render') async render(@Req() req: Request, @Body() raw: unknown) {
    await this.actor(req);
    const p = z
      .strictObject({
        markdown: z.string().max(500000),
        html: z.string().max(30000).optional(),
        dark: z.boolean().default(false),
      })
      .safeParse(raw);
    if (!p.success) throw new BadRequestException('INVALID_INPUT');
    return p.data.html
      ? renderMobileHtml(p.data.html)
      : renderMobileMarkdown(p.data.markdown, p.data.dark);
  }
  @Header('Cache-Control', 'private, no-store') @Get('bootstrap') async bootstrap(
    @Req() req: Request,
  ) {
    const actor = await this.actor(req);
    const penalties = actor ? await activePenalties(this.db, actor.userId) : [];
    const restricted = penalties.some(
      (p) => !p.board && ['suspension', 'deactivation'].includes(p.capability),
    );
    const s = restricted ? null : await this.snapshots.get(actor?.userId ?? null, false);
    const user = actor
      ? await this.db
          .selectFrom('users')
          .select(['nickname', 'handle'])
          .where('id', '=', actor.userId)
          .executeTakeFirst()
      : null;
    return {
      actor: actor ? { ...actor, ...user } : null,
      restricted,
      penalties,
      boards: s?.boards ?? [],
      userState: s?.userState ?? {},
      postReviews: s?.postReviews ?? [],
      allowRequests: actor
        ? (
            await this.db
              .selectFrom('dm_preferences')
              .select('allow_requests')
              .where('user_id', '=', actor.userId)
              .executeTakeFirst()
          )?.allow_requests !== 0
        : true,
      settings: await new SettingsService(this.db).getPublicSiteSettings(),
    };
  }
  @Header('Cache-Control', 'private, no-store') @Get('feed') async feed(
    @Req() req: Request,
    @Query() raw: unknown,
  ) {
    const p = paging.safeParse(raw);
    if (!p.success) throw new BadRequestException('INVALID_QUERY');
    const { s, actor } = await this.snapshot(req),
      q = p.data;
    let posts = s.content.posts.filter(
      (p) =>
        (!q.board || p.community === q.board) &&
        (!q.author || p.authorId === q.author) &&
        (!q.q || (p.title + ' ' + p.body).toLowerCase().includes(q.q.toLowerCase())),
    );
    if (q.view !== 'all') {
      requireMember({ actor, requestId: 'mobile' });
      posts = posts.filter((p) =>
        q.view === 'bookmarks'
          ? s.userState.bookmarks?.includes(p.id)
          : q.view === 'posts'
            ? p.authorId === actor!.userId
            : s.content.comments[p.id]?.some((r) => r.authorId === actor!.userId),
      );
    }
    posts.sort(
      (a, b) =>
        (q.sort === 'hot' ? b.likes - a.likes : 0) ||
        b.createdAt - a.createdAt ||
        b.id.localeCompare(a.id),
    );
    return this.page(
      posts.map((p) => ({
        ...p,
        liked: s.userState.likes.includes(p.id),
        bookmarked: s.userState.bookmarks?.includes(p.id) ?? false,
        replyCount: s.content.comments[p.id]?.length ?? 0,
        likes: p.likes + Number(s.userState.likes.includes(p.id)),
      })),
      q.limit,
      q.cursor,
    );
  }
  @Header('Cache-Control', 'private, no-store') @Get('posts/:id') async post(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() raw: unknown,
  ) {
    const parsed = paging.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('INVALID_QUERY');
    const { s, actor } = await this.snapshot(req),
      post = s.content.posts.find((p) => p.id === id);
    if (!post) throw new NotFoundException('CONTENT_UNAVAILABLE');
    const { limit, cursor } = parsed.data;
    return {
      post: {
        ...post,
        liked: s.userState.likes.includes(id),
        likes: post.likes + Number(s.userState.likes.includes(id)),
        bookmarked: s.userState.bookmarks?.includes(id) ?? false,
        own: post.authorId === actor?.userId,
        ...(post.authorId === actor?.userId
          ? { editMarkdown: post.html ? postHtmlToMarkdown(post.html) : post.body }
          : {}),
      },
      replies: this.page(
        (s.content.comments[id] ?? []).map((r) => ({
          ...r,
          liked: s.userState.commentLikes.includes(id + ':' + r.id),
          likes: r.likes + Number(s.userState.commentLikes.includes(id + ':' + r.id)),
          own: r.authorId === actor?.userId,
        })),
        limit,
        cursor,
      ),
    };
  }
  @Header('Cache-Control', 'private, no-store') @Get('profiles/:id') async profile(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const { s, actor } = await this.snapshot(req),
      user = await this.db
        .selectFrom('users')
        .select(['id', 'nickname', 'deleted_at'])
        .where('id', '=', id)
        .executeTakeFirst();
    if (!user || user.deleted_at) throw new NotFoundException('USER_UNAVAILABLE');
    const entry = s.profiles.find((p) => p.id === id);
    return {
      id,
      name: user.nickname,
      public: actor?.userId === id || entry?.public !== false,
      profile: actor?.userId === id ? s.userState.profile : (entry?.profile ?? null),
    };
  }
  @Header('Cache-Control', 'private, no-store') @Get('notifications') async notices(
    @Req() req: Request,
    @Query() raw: unknown,
  ) {
    const p = paging.safeParse(raw);
    if (!p.success) throw new BadRequestException('INVALID_QUERY');
    const { s, actor } = await this.snapshot(req);
    requireMember({ actor, requestId: 'mobile' });
    return this.page(
      s.content.notifications.map((n) => ({
        ...n,
        read: s.userState.readNotifications?.includes(n.id) ?? false,
      })),
      p.data.limit,
      p.data.cursor,
    );
  }
  @Post('posts/:id/edit') async editPost(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    const actor = requireMember({ actor: await this.actor(req), requestId: 'mobile' });
    const p = z
      .strictObject({
        id: z.uuid(),
        title: z.string().trim().min(1).max(200),
        markdown: z.string().min(1).max(30000),
      })
      .safeParse(raw);
    if (!p.success) throw new BadRequestException('INVALID_INPUT');
    const html = await markdownPostHtml(p.data.markdown);
    await this.snapshots.save(
      actor.userId,
      {
        id: p.data.id,
        operations: [
          {
            type: 'post.edit',
            postId: id,
            title: p.data.title,
            body: p.data.markdown.slice(0, 2000),
            html,
          },
        ],
      },
      false,
    );
    return { ok: true };
  }
  @Post('operations') async operate(@Req() req: Request, @Body() raw: unknown) {
    const actor = requireMember({ actor: await this.actor(req), requestId: 'mobile' });
    const parsed = Batch.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.operations.some(
        (op) => op.type.startsWith('wiki.') || op.type.startsWith('message.'),
      )
    )
      throw new BadRequestException('INVALID_OPERATION');
    await this.snapshots.save(actor.userId, parsed.data, false);
    return { ok: true, id: parsed.data.id };
  }
}
