import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import {
  PollInput,
  PollVoteInput,
  type PollView,
} from '../../../../../packages/contracts/src/interest.js';
import { parse, requireOwner, visiblePost, writeActor, type InterestDb } from './common.js';

export class PollsService {
  constructor(readonly db: InterestDb) {}
  async view(postId: string, userId: string | null): Promise<PollView | null> {
    await visiblePost(this.db, postId, userId);
    const poll = await this.db
      .selectFrom('interest_polls')
      .selectAll()
      .where('post_id', '=', postId)
      .executeTakeFirst();
    if (!poll) return null;
    const votes = await this.db
      .selectFrom('interest_votes')
      .select(['option_id'])
      .select((eb) => eb.fn.count<number>('user_id').as('count'))
      .where('poll_id', '=', poll.id)
      .groupBy('option_id')
      .execute();
    const mine = userId
      ? await this.db
          .selectFrom('interest_votes')
          .select('option_id')
          .where('poll_id', '=', poll.id)
          .where('user_id', '=', userId)
          .executeTakeFirst()
      : undefined;
    const options = (JSON.parse(poll.options) as string[]).map((text, i) => ({
      text,
      count: Number(votes.find((v) => v.option_id === i)?.count || 0),
    }));
    const total = options.reduce((n, o) => n + o.count, 0);
    return {
      id: poll.id,
      postId,
      question: poll.question,
      options,
      endsAt: poll.ends_at.toISOString(),
      state: poll.state === 'open' && poll.ends_at <= new Date() ? 'closed' : poll.state,
      total,
      myVote: mine?.option_id ?? null,
      canEdit:
        userId === poll.author_id &&
        total === 0 &&
        poll.state === 'open' &&
        poll.ends_at > new Date(),
      version: poll.version,
    };
  }
  async create(ctx: RequestContext, input: unknown) {
    const data = parse(PollInput, input);
    const post = await visiblePost(this.db, data.postId, ctx.actor?.userId || null);
    const actor = await writeActor(this.db, ctx, [post.community], 'publish');
    requireOwner(post.authorId, actor.userId);
    const endsAt = new Date(data.endsAt);
    if (endsAt <= new Date() || endsAt.getTime() > Date.now() + 90 * 86400000)
      throw new BadRequestException('INVALID_POLL_DEADLINE');
    const existing = await this.db
      .selectFrom('interest_polls')
      .select('id')
      .where('post_id', '=', data.postId)
      .executeTakeFirst();
    if (existing) throw new ConflictException('POLL_EXISTS');
    const id = randomUUID();
    await this.db
      .insertInto('interest_polls')
      .values({
        id,
        post_id: data.postId,
        author_id: actor.userId,
        question: data.question,
        options: JSON.stringify(data.options),
        ends_at: endsAt,
        state: 'open',
        version: 1,
        created_at: new Date(),
      })
      .onDuplicateKeyUpdate({ post_id: data.postId })
      .execute();
    if (
      !(await this.db
        .selectFrom('interest_polls')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst())
    )
      throw new ConflictException('POLL_EXISTS');
    return this.view(data.postId, actor.userId);
  }
  async edit(ctx: RequestContext, postId: string, input: unknown) {
    const data = parse(PollInput, { ...(typeof input === 'object' && input ? input : {}), postId });
    const post = await visiblePost(this.db, postId, ctx.actor?.userId || null);
    const actor = await writeActor(this.db, ctx, [post.community], 'publish');
    await this.db.transaction().execute(async (tx) => {
      const poll = await tx
        .selectFrom('interest_polls')
        .selectAll()
        .where('post_id', '=', postId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      requireOwner(poll.author_id, actor.userId);
      const vote = await tx
        .selectFrom('interest_votes')
        .select('user_id')
        .where('poll_id', '=', poll.id)
        .executeTakeFirst();
      if (vote || poll.ends_at <= new Date() || poll.state !== 'open')
        throw new ConflictException('POLL_FROZEN');
      const endsAt = new Date(data.endsAt);
      if (endsAt <= new Date() || endsAt.getTime() > Date.now() + 90 * 86400000)
        throw new BadRequestException('INVALID_POLL_DEADLINE');
      await tx
        .updateTable('interest_polls')
        .set({
          question: data.question,
          options: JSON.stringify(data.options),
          ends_at: endsAt,
          version: poll.version + 1,
        })
        .where('id', '=', poll.id)
        .execute();
    });
    return this.view(postId, actor.userId);
  }
  async vote(ctx: RequestContext, postId: string, input: unknown) {
    const data = parse(PollVoteInput, input);
    const post = await visiblePost(this.db, postId, ctx.actor?.userId || null);
    const actor = await writeActor(this.db, ctx, [post.community]);
    await this.db.transaction().execute(async (tx) => {
      const poll = await tx
        .selectFrom('interest_polls')
        .selectAll()
        .where('post_id', '=', postId)
        .forUpdate()
        .executeTakeFirst();
      if (!poll) throw new NotFoundException('POLL_NOT_FOUND');
      if (poll.version !== data.version) throw new ConflictException('POLL_VERSION_CHANGED');
      if (poll.state !== 'open' || poll.ends_at <= new Date())
        throw new ConflictException('POLL_CLOSED');
      if (data.option >= (JSON.parse(poll.options) as string[]).length)
        throw new BadRequestException('INVALID_OPTION');
      await tx
        .insertInto('interest_votes')
        .values({
          poll_id: poll.id,
          user_id: actor.userId,
          option_id: data.option,
          created_at: new Date(),
        })
        .onDuplicateKeyUpdate({ option_id: data.option })
        .execute();
    });
    return this.view(postId, actor.userId);
  }
  async cancel(ctx: RequestContext, postId: string) {
    const post = await visiblePost(this.db, postId, ctx.actor?.userId || null);
    const actor = await writeActor(this.db, ctx, [post.community]);
    const poll = await this.db
      .selectFrom('interest_polls')
      .select('author_id')
      .where('post_id', '=', postId)
      .executeTakeFirst();
    if (!poll) throw new NotFoundException('POLL_NOT_FOUND');
    requireOwner(poll.author_id, actor.userId);
    await this.db
      .updateTable('interest_polls')
      .set({ state: 'cancelled' })
      .where('post_id', '=', postId)
      .where('author_id', '=', actor.userId)
      .execute();
    return this.view(postId, actor.userId);
  }
}
