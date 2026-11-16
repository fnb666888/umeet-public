import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { type Kysely, type Transaction, type Selectable } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from '../identity/auth.controller.js';
import { requireUnrestricted } from '../admin/restrictions.js';
import { GovernanceService } from '../admin/governance.service.js';
import type {
  Conversation,
  Message,
  InboxSummary,
} from '../../../../../packages/contracts/src/messaging.js';
type DB = Kysely<Database> | Transaction<Database>;
type Stored = Selectable<Database['demo_messages']>;
export const conversationId = (a: string, b: string) =>
  createHash('sha256').update([a, b].sort().join(':')).digest('hex');

@Injectable()
export class MessagingService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}
  private message(row: Stored, user: string): Message {
    return {
      id: row.id,
      text: row.text,
      postId: row.post_id,
      createdAt: row.created_at.toISOString(),
      incoming: row.recipient_id === user,
    };
  }
  private async peer(db: DB, user: string, peer: string) {
    if (user === peer) throw new BadRequestException('INVALID_RECIPIENT');
    const row = await db
      .selectFrom('users')
      .select(['id', 'nickname', 'deleted_at'])
      .where('id', '=', peer)
      .where('kind', '=', 'member')
      .executeTakeFirst();
    if (!row) throw new NotFoundException('USER_NOT_FOUND');
    return row;
  }
  private async ensure(db: Transaction<Database>, user: string, peer: string) {
    const id = conversationId(user, peer);
    const [first_user, second_user] = [user, peer].sort() as [string, string];
    await db
      .insertInto('dm_conversations')
      .values({
        id,
        first_user,
        second_user,
        requested_by: user,
        status: 'pending',
        updated_at: new Date(),
      })
      .onDuplicateKeyUpdate({ id })
      .execute();
    const conversation = await db
      .selectFrom('dm_conversations')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    for (const user_id of [user, peer])
      await db
        .insertInto('dm_members')
        .values({ conversation_id: id, user_id, muted: 0, blocked: 0, hidden: 0 })
        .onDuplicateKeyUpdate({ user_id })
        .execute();
    return conversation;
  }
  async detail(user: string, peer: string, db: DB = this.db): Promise<Conversation> {
    const person = await this.peer(db, user, peer);
    const id = conversationId(user, peer);
    const conversation = await db
      .selectFrom('dm_conversations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    const members = await db
      .selectFrom('dm_members')
      .selectAll()
      .where('conversation_id', '=', id)
      .execute();
    const own = members.find((m) => m.user_id === user),
      other = members.find((m) => m.user_id === peer);
    const profile = await db
      .selectFrom('demo_user_states')
      .select('data')
      .where('user_id', '=', peer)
      .executeTakeFirst();
    const last = await db
      .selectFrom('demo_messages')
      .selectAll()
      .where('conversation_id', '=', id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    const count = await db
      .selectFrom('demo_messages')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('conversation_id', '=', id)
      .where('recipient_id', '=', user)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    const pref = await db
      .selectFrom('dm_preferences')
      .selectAll()
      .where('user_id', '=', peer)
      .executeTakeFirst();
    return {
      peer,
      name: person.deleted_at ? '已注销用户' : person.nickname,
      avatar: person.deleted_at ? '' : JSON.parse(profile?.data || '{}').profile?.avatar || '',
      deleted: !!person.deleted_at,
      status: last ? (conversation!.status as Conversation['status']) : 'new',
      incomingRequest:
        !!last &&
        !!conversation &&
        conversation.requested_by !== user &&
        conversation.status === 'pending',
      blocked: !!own?.blocked,
      unavailable: !!person.deleted_at || !!other?.blocked || (!last && pref?.allow_requests === 0),
      muted: !!own?.muted,
      hidden: !!own?.hidden,
      unread: Number(count.count),
      lastMessage: last ? this.message(last, user) : null,
      updatedAt: last?.created_at.toISOString() || null,
    };
  }
  async list(user: string, view: string, cursor?: string): Promise<InboxSummary> {
    let query = this.db
      .selectFrom('dm_conversations as c')
      .innerJoin('dm_members as m', 'm.conversation_id', 'c.id')
      .select(['c.id', 'c.first_user', 'c.second_user', 'c.updated_at'])
      .where('m.user_id', '=', user)
      .where('m.hidden', '=', 0)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('demo_messages as d')
            .select('d.id')
            .whereRef('d.conversation_id', '=', 'c.id'),
        ),
      );
    if (view === 'requests')
      query = query.where('c.status', '=', 'pending').where('c.requested_by', '!=', user);
    else
      query = query
        .where('c.status', '!=', 'ignored')
        .where((eb) => eb.or([eb('c.status', '=', 'accepted'), eb('c.requested_by', '=', user)]));
    if (view === 'unread')
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('demo_messages as d')
            .select('d.id')
            .whereRef('d.conversation_id', '=', 'c.id')
            .where('d.recipient_id', '=', user)
            .where('d.read_at', 'is', null),
        ),
      );
    if (cursor) {
      const boundary = await this.db
        .selectFrom('dm_conversations')
        .select(['updated_at', 'id'])
        .where('id', '=', cursor)
        .where((eb) => eb.or([eb('first_user', '=', user), eb('second_user', '=', user)]))
        .executeTakeFirst();
      if (!boundary) throw new BadRequestException('INVALID_CURSOR');
      query = query.where((eb) =>
        eb.or([
          eb('c.updated_at', '<', boundary.updated_at),
          eb.and([eb('c.updated_at', '=', boundary.updated_at), eb('c.id', '<', boundary.id)]),
        ]),
      );
    }
    const rows = await query
      .orderBy('c.updated_at', 'desc')
      .orderBy('c.id', 'desc')
      .limit(31)
      .execute();
    const conversations = await Promise.all(
      rows
        .slice(0, 30)
        .map((row) =>
          this.detail(user, row.first_user === user ? row.second_user : row.first_user),
        ),
    );
    const unread = await this.db
      .selectFrom('demo_messages as d')
      .innerJoin('dm_members as m', 'm.conversation_id', 'd.conversation_id')
      .innerJoin('dm_conversations as c', 'c.id', 'd.conversation_id')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('d.recipient_id', '=', user)
      .where('m.user_id', '=', user)
      .where('m.muted', '=', 0)
      .where('m.blocked', '=', 0)
      .where('m.hidden', '=', 0)
      .where('c.status', '=', 'accepted')
      .where('d.read_at', 'is', null)
      .executeTakeFirstOrThrow();
    const requests = await this.db
      .selectFrom('dm_conversations as c')
      .innerJoin('dm_members as m', 'm.conversation_id', 'c.id')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('m.user_id', '=', user)
      .where('m.hidden', '=', 0)
      .where('m.blocked', '=', 0)
      .where('c.status', '=', 'pending')
      .where('c.requested_by', '!=', user)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('demo_messages as d')
            .select('d.id')
            .whereRef('d.conversation_id', '=', 'c.id'),
        ),
      )
      .executeTakeFirstOrThrow();
    const pref = await this.db
      .selectFrom('dm_preferences')
      .selectAll()
      .where('user_id', '=', user)
      .executeTakeFirst();
    return {
      conversations,
      next: rows.length > 30 ? rows[29]!.id : null,
      unread: Number(unread.count),
      requests: Number(requests.count),
      allowRequests: pref?.allow_requests !== 0,
    };
  }
  async history(user: string, peer: string, before?: string, after?: string) {
    const conversation = await this.detail(user, peer);
    let query = this.db
      .selectFrom('demo_messages')
      .selectAll()
      .where('conversation_id', '=', conversationId(user, peer));
    if (before && after) throw new BadRequestException('INVALID_CURSOR');
    const cursor = before || after;
    if (cursor) {
      const boundary = await this.db
        .selectFrom('demo_messages')
        .selectAll()
        .where('id', '=', cursor)
        .where('conversation_id', '=', conversationId(user, peer))
        .executeTakeFirst();
      if (!boundary) throw new BadRequestException('INVALID_CURSOR');
      query = query.where((eb) =>
        eb.or([
          eb('created_at', after ? '>' : '<', boundary.created_at),
          eb.and([
            eb('created_at', '=', boundary.created_at),
            eb('id', after ? '>' : '<', boundary.id),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('created_at', after ? 'asc' : 'desc')
      .orderBy('id', after ? 'asc' : 'desc')
      .limit(51)
      .execute();
    return {
      conversation,
      messages: (after ? rows.slice(0, 50) : rows.slice(0, 50).reverse()).map((row) =>
        this.message(row, user),
      ),
      hasMore: rows.length > 50,
    };
  }
  async search(user: string, q: string) {
    if (q.trim().length < 2) return [];
    const term = q.trim().replace(/[\%_]/g, '\$&');
    const users = await this.db
      .selectFrom('users')
      .select(['id', 'nickname'])
      .where('kind', '=', 'member')
      .where('deleted_at', 'is', null)
      .where('id', '!=', user)
      .where('nickname', 'like', term + '%')
      .orderBy('nickname')
      .limit(12)
      .execute();
    return users.map((row) => ({ id: row.id, name: row.nickname }));
  }
  async preferences(user: string, allowRequests: boolean) {
    await this.db
      .insertInto('dm_preferences')
      .values({ user_id: user, allow_requests: Number(allowRequests) })
      .onDuplicateKeyUpdate({ allow_requests: Number(allowRequests) })
      .execute();
    return { allowRequests };
  }
  async send(
    user: string,
    peer: string,
    input: { id: string; text: string; postId?: string | undefined },
    database?: Transaction<Database>,
  ) {
    const work = async (tx: Transaction<Database>) => {
      // Lock participants in a stable order to serialize sends and account closure.
      const participants = await tx
        .selectFrom('users')
        .select(['id', 'deleted_at', 'kind'])
        .where('id', 'in', [user, peer])
        .orderBy('id')
        .forUpdate()
        .execute();
      const actor = participants.find((row) => row.id === user);
      const person = participants.find((row) => row.id === peer);
      if (!actor || actor.deleted_at) throw new ForbiddenException('ACCOUNT_CLOSED');
      if (user === peer) throw new BadRequestException('INVALID_RECIPIENT');
      if (!person || person.kind !== 'member') throw new NotFoundException('USER_NOT_FOUND');
      if (person.deleted_at) throw new ForbiddenException('CONTACT_UNAVAILABLE');
      const conversation = await this.ensure(tx, user, peer);
      const previous = await tx
        .selectFrom('demo_messages')
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirst();
      if (previous) {
        if (
          previous.sender_id !== user ||
          previous.recipient_id !== peer ||
          previous.text !== input.text ||
          previous.post_id !== (input.postId || null)
        )
          throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return this.message(previous, user);
      }
      const members = await tx
        .selectFrom('dm_members')
        .selectAll()
        .where('conversation_id', '=', conversation.id)
        .execute();
      await requireUnrestricted(tx, user, [], 'messages');
      if (members.some((m) => m.blocked)) throw new ForbiddenException('CONTACT_UNAVAILABLE');
      if (input.postId && await tx.selectFrom('admin_visibility').select('target')
        .where('target', '=', 'post:' + input.postId).where('hidden', '=', 1).executeTakeFirst())
        throw new NotFoundException('POST_NOT_FOUND');
      const pref = await tx
        .selectFrom('dm_preferences')
        .selectAll()
        .where('user_id', '=', peer)
        .executeTakeFirst();
      const existing = await tx
        .selectFrom('demo_messages')
        .select('id')
        .where('conversation_id', '=', conversation.id)
        .executeTakeFirst();
      if (conversation.status === 'ignored' || (conversation.status === 'pending' && existing))
        throw new ForbiddenException('REQUEST_PENDING');
      if (conversation.status !== 'accepted' && pref?.allow_requests === 0)
        throw new ForbiddenException('REQUESTS_DISABLED');
      const recent = await tx
        .selectFrom('demo_messages')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('sender_id', '=', user)
        .where('created_at', '>', new Date(Date.now() - 60000))
        .executeTakeFirstOrThrow();
      if (Number(recent.count) >= 20) throw new HttpException('MESSAGE_RATE_LIMIT', 429);
      if (
        input.postId &&
        !(await tx
          .selectFrom('demo_entities')
          .select('id')
          .where('id', '=', input.postId)
          .where('kind', '=', 'post')
          .executeTakeFirst())
      )
        throw new NotFoundException('POST_NOT_FOUND');
      const created_at = new Date(Math.max(Date.now(), conversation.updated_at.getTime() + 1));
      const row = {
        id: input.id,
        sender_id: user,
        recipient_id: peer,
        text: input.text,
        post_id: input.postId || null,
        created_at,
        read_at: null,
        conversation_id: conversation.id,
      };
      await tx.insertInto('demo_messages').values(row).execute();
      await tx
        .updateTable('dm_conversations')
        .set({ updated_at: created_at, requested_by: existing ? conversation.requested_by : user })
        .where('id', '=', conversation.id)
        .execute();
      await tx
        .updateTable('dm_members')
        .set({ hidden: 0 })
        .where('conversation_id', '=', conversation.id)
        .execute();
      return this.message(row, user);
    };
    return database ? work(database) : this.db.transaction().execute(work);
  }
  async action(
    user: string,
    peer: string,
    action: import('zod').infer<
      typeof import('../../../../../packages/contracts/src/messaging.js').ConversationAction
    >,
  ) {
    await this.peer(this.db, user, peer);
    await this.db.transaction().execute(async (tx) => {
      if (action.action === 'report') {
        await tx.selectFrom('demo_content').select('id').where('id', '=', 'global').forUpdate().executeTakeFirstOrThrow();
        await new GovernanceService(tx).record(user, { target: 'message:' + action.messageId, category: 'other', detail: action.reason });
      }
      const c = await this.ensure(tx, user, peer);
      const own = await tx
        .selectFrom('dm_members')
        .selectAll()
        .where('conversation_id', '=', c.id)
        .where('user_id', '=', user)
        .executeTakeFirstOrThrow();
      if (action.action === 'accept' || action.action === 'ignore') {
        const request = await tx
          .selectFrom('demo_messages')
          .select('id')
          .where('conversation_id', '=', c.id)
          .executeTakeFirst();
        if (!request || c.status !== 'pending' || c.requested_by === user || own.blocked)
          throw new BadRequestException('INVALID_REQUEST');
        await tx
          .updateTable('dm_conversations')
          .set({ status: action.action === 'accept' ? 'accepted' : 'ignored' })
          .where('id', '=', c.id)
          .execute();
        await tx
          .updateTable('dm_members')
          .set({ hidden: action.action === 'ignore' ? 1 : 0 })
          .where('conversation_id', '=', c.id)
          .where('user_id', '=', user)
          .execute();
      } else if (action.action === 'read') {
        const boundary = await tx
          .selectFrom('demo_messages')
          .selectAll()
          .where('conversation_id', '=', c.id)
          .where('id', '=', action.messageId)
          .executeTakeFirst();
        if (!boundary) throw new BadRequestException('INVALID_CURSOR');
        await tx
          .updateTable('demo_messages')
          .set({ read_at: new Date() })
          .where('conversation_id', '=', c.id)
          .where('recipient_id', '=', user)
          .where('read_at', 'is', null)
          .where((eb) =>
            eb.or([
              eb('created_at', '<', boundary.created_at),
              eb.and([eb('created_at', '=', boundary.created_at), eb('id', '<=', boundary.id)]),
            ]),
          )
          .execute();
      } else if (action.action === 'report') {
        const message = await tx
          .selectFrom('demo_messages')
          .select('id')
          .where('id', '=', action.messageId)
          .where('conversation_id', '=', c.id)
          .where('recipient_id', '=', user)
          .executeTakeFirst();
        if (!message) throw new NotFoundException('MESSAGE_NOT_FOUND');
        const id = createHash('sha256')
          .update(user + ':' + action.id)
          .digest('hex');
        await tx
          .insertInto('dm_reports')
          .values({
            id,
            reporter_id: user,
            message_id: action.messageId,
            reason: action.reason,
            created_at: new Date(),
          })
          .onDuplicateKeyUpdate({ id })
          .execute();
      } else {
        const changes =
          action.action === 'block'
            ? { blocked: Number(action.value) }
            : action.action === 'mute'
              ? { muted: Number(action.value) }
              : { hidden: action.action === 'hide' ? 1 : 0 };
        await tx
          .updateTable('dm_members')
          .set(changes)
          .where('conversation_id', '=', c.id)
          .where('user_id', '=', user)
          .execute();
      }
    });
    return this.detail(user, peer);
  }
}
