import { isContentBoard } from '../../../../../packages/contracts/src/interest.js';
import { listBoards, requireBoards } from '../communities/board-directory.js';
import { legacyBoardCommunities } from '../../../../../packages/contracts/src/boards.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { MessagingService } from '../messaging/messaging.service.js';
import { requireCapability, requireUnrestricted, activePenalties } from '../admin/restrictions.js';
import { GovernanceService } from '../admin/governance.service.js';
import { publicWiki } from '../admin/wiki-visibility.js';
import { hasModerationPermission, moderationAccess } from '../admin/scope.js';
import { DATABASE } from '../identity/auth.controller.js';
import { SettingsService } from '../settings/settings.service.js';
import { storeDemoAssets } from './demo-assets.js';
import {
  emptyContent,
  type DemoBatch,
  type DemoContent,
  type DemoOperation,
  type DemoState,
} from './demo.schema.js';

@Injectable()
export class DemoSnapshotsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async get(userId: string | null, includeMessages = true) {
    // These reads do not depend on each other. Remote DB round trips must not
    // accumulate for every page/account initialization.
    const [
      row,
      content,
      visibility,
      own,
      postReviews,
      users,
      preferences,
      messages,
      management,
      boards,
    ] = await Promise.all([
      this.db
        .selectFrom('demo_content')
        .select('version')
        .where('id', '=', 'global')
        .executeTakeFirst(),
      this.loadContent(this.db),
      this.db.selectFrom('admin_visibility').selectAll().where('hidden', '=', 1).execute(),
      userId
        ? this.db
            .selectFrom('demo_user_states')
            .select('data')
            .where('user_id', '=', userId)
            .executeTakeFirst()
        : undefined,
      userId
        ? this.db
            .selectFrom('post_reviews')
            .select(['id', 'board', 'status', 'reason', 'created_at'])
            .select(sql<string>`JSON_UNQUOTE(JSON_EXTRACT(data, '$.title'))`.as('title'))
            .where('user_id', '=', userId)
            .orderBy('created_at', 'desc')
            .limit(50)
            .execute()
        : [],
      this.db
        .selectFrom('users')
        .select(['id', 'nickname', 'deleted_at'])
        .where('kind', '=', 'member')
        .execute(),
      this.db.selectFrom('demo_user_states').select(['user_id', 'data']).execute(),
      userId && includeMessages
        ? this.db
            .selectFrom('demo_messages')
            .selectAll()
            .where((eb) => eb.or([eb('sender_id', '=', userId), eb('recipient_id', '=', userId)]))
            .orderBy('created_at')
            .execute()
        : [],
      userId
        ? this.db
            .selectFrom('admin_notifications')
            .selectAll()
            .where('user_id', '=', userId)
            .orderBy('created_at', 'desc')
            .limit(100)
            .execute()
        : [],
      listBoards(this.db),
    ]);
    const hidden = new Set(visibility.map((item) => item.target));
    const tombstones = content.posts
      .filter((post) => hidden.has('post:' + post.id))
      .map((post) => ({ id: post.id, community: post.community }));
    content.posts = content.posts.filter((post) => !hidden.has('post:' + post.id));
    const visiblePosts = new Set(content.posts.map((post) => post.id));
    for (const [postId, replies] of Object.entries(content.comments)) {
      if (!visiblePosts.has(postId)) {
        delete content.comments[postId];
        continue;
      }
      for (const reply of replies) {
        if (hidden.has('reply:' + postId + ':' + reply.id)) {
          reply.body = '该回复已被管理员隐藏';
          delete reply.image;
          delete reply.replyBody;
        }
        if (reply.replyTo && hidden.has('reply:' + postId + ':' + reply.replyTo))
          reply.replyBody = '该回复已被管理员隐藏';
      }
    }
    for (const post of content.posts)
      if (post.best && hidden.has('reply:' + post.id + ':' + post.best)) {
        delete post.best;
        delete post.wikiRef;
      }
    const state: DemoState = own ? JSON.parse(own.data) : {};
    state.followedBoards ??= Object.keys(legacyBoardCommunities);
    const publicProfiles = preferences.map((row) => ({
      id: row.user_id,
      state: JSON.parse(row.data) as DemoState,
    }));
    const names = new Map(users.map((user) => [user.id, user.nickname]));
    if (state.profile && userId) state.profile.name = names.get(userId) || state.profile.name;
    for (const item of publicProfiles)
      if (item.state.profile)
        item.state.profile.name = names.get(item.id) || item.state.profile.name;
    const author = (item: { authorId: string; author: string }) =>
      names.get(item.authorId) || item.author;
    const threads = new Map<
      string,
      {
        peer: string;
        unread: boolean;
        messages: { id: string; text: string; postId?: string; incoming: boolean }[];
      }
    >();
    for (const message of messages) {
      const incoming = message.recipient_id === userId;
      const peer = incoming ? message.sender_id : message.recipient_id;
      const thread = threads.get(peer) || { peer, unread: false, messages: [] };
      thread.unread ||= incoming && !message.read_at;
      thread.messages.push({
        id: message.id,
        text: message.text,
        ...(message.post_id ? { postId: message.post_id } : {}),
        incoming,
      });
      threads.set(peer, thread);
    }
    const notices: { id: string; text: string; detail: string; href: string; createdAt: number }[] =
      [];
    if (userId) {
      notices.push(
        ...management.map((notice) => ({
          id: notice.id,
          text: notice.text,
          detail: notice.detail,
          href: notice.href,
          createdAt: notice.created_at.getTime(),
        })),
      );
    }
    if (userId)
      for (const post of content.posts) {
        for (const reply of content.comments[post.id] || []) {
          if (reply.authorId === userId) continue;
          const target =
            reply.replyTo && content.comments[post.id]?.find((item) => item.id === reply.replyTo);
          if (
            (state.notifPrefs?.reply !== false &&
              (post.authorId === userId || (target && target.authorId === userId))) ||
            (state.notifPrefs?.follow !== false && state.follows?.includes(post.id))
          ) {
            notices.push({
              id: 'reply-' + reply.id,
              text: author(reply) + ' 回复了帖子',
              detail: post.title,
              href: '#/posts/' + post.id + '#cm-' + reply.id,
              createdAt: reply.createdAt,
            });
          }
        }
        if (
          post.authorId !== userId &&
          state.notifPrefs?.follow !== false &&
          post.tags?.some((tag) => state.tagFollows?.includes(tag))
        )
          notices.push({
            id: 'post-' + post.id,
            text: '关注的标签有新帖',
            detail: post.title,
            href: '#/posts/' + post.id,
            createdAt: post.createdAt,
          });
      }
    const likes = content.posts
      .filter((post) => content.votes[post.id]?.includes(userId || ''))
      .map((post) => post.id);
    const commentLikes = Object.keys(content.commentVotes).filter((key) =>
      content.commentVotes[key]?.includes(userId || ''),
    );
    return {
      boards,
      version: row?.version || 0,
      tombstones,
      postReviews: postReviews.map((review) => ({
        id: review.id,
        board: review.board,
        title: review.title,
        status: review.status,
        reason: review.reason,
        createdAt: review.created_at.toISOString(),
      })),
      content: {
        posts: content.posts.map((post) => ({
          ...post,
          author: author(post),
          stars:
            publicProfiles.filter((item) => item.state.bookmarks?.includes(post.id)).length -
            Number(Boolean(state.bookmarks?.includes(post.id))),
          likes: (content.votes[post.id]?.length || 0) - Number(likes.includes(post.id)),
        })),
        comments: Object.fromEntries(
          Object.entries(content.comments).map(([postId, replies]) => [
            postId,
            replies.map((reply) => ({
              ...reply,
              author: author(reply),
              ...(reply.replyTo
                ? {
                    replyToName:
                      names.get(
                        replies.find((parent) => parent.id === reply.replyTo)?.authorId || '',
                      ) || reply.replyToName,
                  }
                : {}),
              likes:
                (content.commentVotes[postId + ':' + reply.id]?.length || 0) -
                Number(commentLikes.includes(postId + ':' + reply.id)),
            })),
          ]),
        ),
        wiki: content.wiki.map((wiki) => ({
          ...wiki,
          editor: names.get(wiki.editorId || '') || wiki.editor,
          history: publicWiki(wiki).history.map((entry) => ({
            ...entry,
            author: names.get(String(entry['authorId'])) || entry['author'],
          })),
          notes: wiki.notes.map((entry) => ({
            ...entry,
            author: names.get(String(entry['authorId'])) || entry['author'],
          })),
          suggestions: wiki.suggestions.map((entry) => ({
            ...entry,
            author: names.get(String(entry['authorId'])) || entry['author'],
          })),
        })),
        notifications: notices.sort((a, b) => b.createdAt - a.createdAt).slice(0, 200),
      },
      userState: {
        ...state,
        likes,
        commentLikes,
        best: Object.fromEntries(
          content.posts.filter((post) => post.best).map((post) => [post.id, post.best]),
        ),
        threads: [...threads.values()],
      },
      profiles: publicProfiles.map((item) => ({
        id: item.id,
        public: item.state.privacyPrefs?.profilePublic !== false,
        ...(item.state.privacyPrefs?.profilePublic !== false
          ? {
              profile: item.state.profile,
              bookmarks: item.state.privacyPrefs?.marksPublic ? item.state.bookmarks : [],
            }
          : {}),
      })),
      contacts: users
        .filter((user) => user.id !== userId && !user.deleted_at)
        .map((user) => ({ id: user.id, name: user.nickname })),
    };
  }

  async save(userId: string, batch: DemoBatch, includeMessages = true, returnSnapshot = true) {
    const hash = createHash('sha256').update(JSON.stringify(batch)).digest('hex');
    await this.db.transaction().execute(async (tx) => {
      // Lock shared content before checking retries and reading account state.
      const row = await tx
        .selectFrom('demo_content')
        .selectAll()
        .where('id', '=', 'global')
        .forUpdate()
        .executeTakeFirstOrThrow();
      const operationId = userId + ':' + batch.id;
      const previous = await tx
        .selectFrom('demo_operations')
        .select('request_hash')
        .where('id', '=', operationId)
        .executeTakeFirst();
      if (previous) {
        if (previous.request_hash !== hash) throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return;
      }
      const user = await tx
        .selectFrom('users')
        .select(['nickname', 'deleted_at'])
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      const local=batch.operations.every(op=>op.type==='state.save'||op.type==='profile.save'||('postId' in op && !op.type.startsWith('wiki.') && !['post.wiki','post.report','message.send','reply.create'].includes(op.type)));
      const selected=local?[...new Set(batch.operations.flatMap(op=>'postId' in op && op.postId?[op.postId]:[]))]:undefined;
      const content = await this.loadContent(tx,selected);
      await requireCapability(tx, userId, 'suspension');
      if (user.deleted_at) throw new UnauthorizedException('AUTH_REQUIRED');
      const original = this.entityRows(content);
      const own = await tx
        .selectFrom('demo_user_states')
        .select('data')
        .where('user_id', '=', userId)
        .executeTakeFirst();
      const state: DemoState = own ? JSON.parse(own.data) : {};
      state.followedBoards ??= Object.keys(legacyBoardCommunities);
      const moderation = await tx.selectFrom('admin_visibility').selectAll().where('hidden', '=', 1).execute();
      const hidden = new Set(moderation.map(item => item.target));
      const posting = batch.operations.some((op) => op.type === 'post.create' || op.type === 'reply.create')
        ? (await new SettingsService(tx).getSiteSettings()).settings.boards : null;
      for (const op of batch.operations) {
        const post = 'postId' in op ? content.posts.find(post => post.id === op.postId) : undefined;
        const wiki = 'wikiId' in op ? content.wiki.find(wiki => wiki.id === op.wikiId)
          : op.type === 'wiki.save' ? content.wiki.find(wiki => wiki.id === op.wiki.id) : undefined;
        const scopes = op.type === 'post.create' ? [op.post.community]
          : post ? [post.community] : op.type === 'wiki.save' ? [...new Set([...(wiki?.communities || []), ...op.wiki.communities])]
          : wiki?.communities || [];
        if (op.type === 'post.create' && isContentBoard(op.post.community)) throw new ForbiddenException('SYSTEM_CONTENT_BOARD');
        if (op.type === 'post.create' || op.type === 'wiki.save') await requireBoards(tx, scopes);
        if (op.type === 'state.save' && op.state.followedBoards) await requireBoards(tx, op.state.followedBoards);
        if (!['state.save', 'profile.save', 'message.read', 'post.report'].includes(op.type))
          await requireUnrestricted(tx, userId, scopes, op.type.startsWith('wiki.') ? 'wiki' : op.type === 'message.send' ? 'messages' : ['post.create', 'reply.create', 'post.edit', 'reply.edit', 'post.update'].includes(op.type) ? 'publish' : 'interact');
        if (op.type === 'profile.save') await requireCapability(tx, userId, 'profile');
        if (op.type === 'reply.create' && post?.archived) throw new ForbiddenException('POST_ARCHIVED');
        if (op.type === 'reply.create' && post?.locked) throw new ForbiddenException('POST_LOCKED');
        if (posting && (op.type === 'post.create' || op.type === 'reply.create')) {
          const board = op.type === 'post.create' ? op.post.community : post?.community;
          if (board) {
            const policy = posting[board]?.posting ?? { readonly: false, firstPostReview: false, cooldownSeconds: 0 };
            if (policy.readonly) throw new ForbiddenException('BOARD_READ_ONLY');
            const ownPosts = content.posts.filter((item) => item.community === board && item.authorId === userId);
            const reviews = policy.cooldownSeconds
              ? await tx.selectFrom('post_reviews').select('created_at')
                .where('board', '=', board).where('user_id', '=', userId).execute() : [];
            if (policy.cooldownSeconds) {
              const cutoff = Date.now() - policy.cooldownSeconds * 1000;
              const recentReply = content.posts.some((item) => item.community === board &&
                content.comments[item.id]?.some((reply) => reply.authorId === userId && reply.createdAt > cutoff));
              if (recentReply || ownPosts.some((item) => item.createdAt > cutoff) ||
                  reviews.some((item) => item.created_at.getTime() > cutoff))
                throw new ConflictException('BOARD_POST_COOLDOWN');
            }
            if (op.type === 'post.create') {
              const existing = await tx.selectFrom('post_reviews').select('id')
                .where('id', '=', op.post.id).executeTakeFirst();
              if (existing) throw new ConflictException('POST_EXISTS');
            }
          }
        }
        const protection = wiki?.protectionUntil && new Date(wiki.protectionUntil) <= new Date() ? 'open' : wiki?.protection || (wiki?.protected ? 'staff' : 'open');
        if (op.type === 'wiki.save' && protection !== 'open') {
          const access = await moderationAccess(tx, userId);
          const staff = access.admin || (scopes.length > 0 && scopes.every(board => hasModerationPermission(access, board, 'wiki.edit')));
          if (!staff) {
            const registered = await tx.selectFrom('users').select('created_at').where('id', '=', userId).executeTakeFirstOrThrow();
            const legacyGlobal = await tx.selectFrom('admin_restrictions').select('user_id').where('user_id', '=', userId).where('until_at', '>', new Date()).executeTakeFirst();
            const legacyCommunity = await tx.selectFrom('community_restrictions').select('user_id').where('user_id', '=', userId).where('until_at', '>', new Date()).executeTakeFirst();
            if (protection !== 'trusted' || registered.created_at.getTime() > Date.now() - 7 * 86400000 || (await activePenalties(tx, userId)).length || legacyGlobal || legacyCommunity)
              throw new ForbiddenException('WIKI_PROTECTED');
          }
        }
        if ('postId' in op && op.postId && hidden.has('post:' + op.postId))
          throw new ForbiddenException('CONTENT_HIDDEN');
        if (op.type === 'reply.create' && [op.reply.parentId, op.reply.replyTo]
          .some(id => id && hidden.has('reply:' + op.postId + ':' + id)))
          throw new ForbiddenException('CONTENT_HIDDEN');
        if ((op.type === 'reply.vote' || op.type === 'post.accept' || op.type === 'reply.edit') && op.replyId &&
          hidden.has('reply:' + op.postId + ':' + op.replyId)) throw new ForbiddenException('CONTENT_HIDDEN');
        if (op.type === 'message.send') {
          await new MessagingService(this.db).send(userId, op.peer, op, tx);
        } else if (op.type === 'post.report') {
          if (!content.posts.some((post) => post.id === op.postId))
            throw new NotFoundException('POST_NOT_FOUND');
          await new GovernanceService(tx).record(userId, { target: 'post:' + op.postId, category: 'other', detail: op.reason });
        } else if (op.type === 'message.read') {
          await tx
            .updateTable('demo_messages')
            .set({ read_at: new Date() })
            .where('sender_id', '=', op.peer)
            .where('recipient_id', '=', userId)
            .where('read_at', 'is', null)
            .execute();
        } else this.apply(content, state, userId, user.nickname, op);
      }
      for (const entity of this.entityRows(content)) {
        if (original.some((old) => old.id === entity.id && old.data === entity.data)) continue;
        const data = await storeDemoAssets(tx, JSON.parse(entity.data));
        await tx
          .insertInto('demo_entities')
          .values({ ...entity, data: JSON.stringify(data) })
          .onDuplicateKeyUpdate({ data: JSON.stringify(data) })
          .execute();
      }
      if(batch.operations.some(op=>op.type==='state.save'&&op.state.bookmarks!==undefined)){
        await tx.deleteFrom('community_post_bookmarks').where('user_id','=',userId).execute();
        const marks=[...new Set(state.bookmarks||[])];
        if(marks.length)await tx.insertInto('community_post_bookmarks').values(marks.map(post_id=>({user_id:userId,post_id}))).execute();
      }
      if (state.profile?.avatar?.startsWith('data:'))
        state.profile.avatar = String(await storeDemoAssets(tx, state.profile.avatar, 'avatar'));
      await tx
        .updateTable('demo_content')
        .set({ version: row.version + 1, updated_at: new Date() })
        .where('id', '=', 'global')
        .execute();
      await tx
        .insertInto('demo_user_states')
        .values({ user_id: userId, data: JSON.stringify(state), updated_at: new Date() })
        .onDuplicateKeyUpdate({ data: JSON.stringify(state), updated_at: new Date() })
        .execute();
      await tx
        .insertInto('demo_operations')
        .values({ id: operationId, request_hash: hash, created_at: new Date() })
        .execute();
    });
    return returnSnapshot ? this.get(userId, includeMessages) : null;
  }

  private async loadContent(db: Kysely<Database> | Transaction<Database>, postIds?:string[]): Promise<DemoContent> {
    const content = emptyContent();
    let read=db.selectFrom('demo_entities').selectAll();
    if(postIds){
      if(!postIds.length)return content;
      read=read.where(eb=>eb.or([
        eb('id','in',postIds.flatMap(id=>['post:'+id,'vote:'+id])),
        eb.and([eb('kind','=','reply'),eb('page_parent','in',postIds)]),
        ...postIds.map(id=>eb.and([eb('id','>=','replyVote:'+id+':'),eb('id','<','replyVote:'+id+';')])),
      ]));
    }
    const rows = await read.execute();
    for (const row of rows) {
      const value = JSON.parse(row.data);
      if (row.kind === 'post') content.posts.push(value);
      if (row.kind === 'wiki') content.wiki.push(value);
      if (row.kind === 'reply') {
        const { postId, ...reply } = value;
        (content.comments[postId] ||= []).push(reply);
      }
      if (row.kind === 'vote') content.votes[row.id.slice(5)] = value;
      if (row.kind === 'replyVote') content.commentVotes[row.id.slice(10)] = value;
    }
    content.posts.sort((a, b) => b.createdAt - a.createdAt);
    for (const replies of Object.values(content.comments))
      replies.sort((a, b) => a.createdAt - b.createdAt);
    return content;
  }

  private entityRows(content: DemoContent) {
    return [
      ...content.posts.map((post) => ({
        id: 'post:' + post.id,
        kind: 'post',
        data: JSON.stringify({...post, replyCount:(content.comments[post.id]||[]).length,
          activityAt:Math.max(post.createdAt,...(content.comments[post.id]||[]).map(r=>r.createdAt)),
          feedScore:(content.votes[post.id]?.length||0)+post.createdAt/1800000}),
      })),
      ...content.wiki.map((value) => ({
        id: 'wiki:' + value.id,
        kind: 'wiki',
        data: JSON.stringify(value),
      })),
      ...Object.entries(content.comments).flatMap(([postId, replies]) =>
        replies.map((value) => ({
          id: 'reply:' + postId + ':' + value.id,
          kind: 'reply',
          data: JSON.stringify({ postId, ...value,replyScore:(content.commentVotes[postId+':'+value.id]?.length||0)+value.createdAt/100000000000000 }),
        })),
      ),
      ...Object.entries(content.votes).map(([id, value]) => ({
        id: 'vote:' + id,
        kind: 'vote',
        data: JSON.stringify(value),
      })),
      ...Object.entries(content.commentVotes).map(([id, value]) => ({
        id: 'replyVote:' + id,
        kind: 'replyVote',
        data: JSON.stringify(value),
      })),
    ];
  }

  private apply(
    content: DemoContent,
    state: DemoState,
    userId: string,
    name: string,
    op: DemoOperation,
  ) {
    if (op.type === 'state.save') {
      Object.assign(state, op.state);
      return;
    }
    if (op.type === 'profile.save') {
      state.profile = { ...op.profile, name };
      return;
    }
    if (op.type === 'post.create') {
      if (content.posts.some((post) => post.id === op.post.id))
        throw new ConflictException('POST_EXISTS');
      if (
        !op.post.body.trim() &&
        !op.post.images?.length &&
        !Object.values(op.post.project || {}).some(Boolean)
      )
        throw new BadRequestException('EMPTY_POST');
      content.posts.unshift({
        ...op.post,
        author: name,
        authorId: userId,
        createdAt: Date.now(),
        likes: 0,
      });
      content.comments[op.post.id] = [];
      return;
    }
    if (op.type.startsWith('wiki.')) {
      this.applyWiki(content, userId, name, op);
      return;
    }
    if (!('postId' in op)) throw new BadRequestException('INVALID_OPERATION');
    const post = content.posts.find((post) => post.id === op.postId);
    if (!post) throw new NotFoundException('POST_NOT_FOUND');
    if (op.type === 'reply.edit') {
      const reply = content.comments[post.id]?.find(reply => reply.id === op.replyId);
      if (!reply) throw new NotFoundException('REPLY_NOT_FOUND');
      if (reply.authorId !== userId) throw new ForbiddenException('POST_OWNER_REQUIRED');
      reply.body = op.body;
      for (const quote of content.comments[post.id] || []) if (quote.replyTo === reply.id) quote.replyBody = reply.body;
      return;
    }
    if (op.type === 'reply.create') {
      const replies = (content.comments[post.id] ||= []);
      if (replies.some((reply) => reply.id === op.reply.id))
        throw new ConflictException('REPLY_EXISTS');
      const parent = op.reply.parentId
        ? replies.find((reply) => reply.id === op.reply.parentId)
        : undefined;
      const target = op.reply.replyTo
        ? replies.find((reply) => reply.id === op.reply.replyTo)
        : undefined;
      if ((op.reply.parentId && !parent) || (op.reply.replyTo && !target))
        throw new BadRequestException('INVALID_REPLY_TARGET');
      if (!op.reply.body.trim() && !op.reply.image) throw new BadRequestException('EMPTY_REPLY');
      replies.push({
        ...op.reply,
        author: name,
        authorId: userId,
        createdAt: Date.now(),
        likes: 0,
        ...(target ? { replyToName: target.author, replyBody: target.body } : {}),
      });
      return;
    }
    if (op.type === 'post.vote' || op.type === 'reply.vote') {
      const key = op.type === 'post.vote' ? post.id : post.id + ':' + op.replyId;
      if (
        op.type === 'reply.vote' &&
        !content.comments[post.id]?.some((reply) => reply.id === op.replyId)
      )
        throw new NotFoundException('REPLY_NOT_FOUND');
      const votes = op.type === 'post.vote' ? content.votes : content.commentVotes;
      const voters = new Set(votes[key] || []);
      if (op.value) voters.add(userId);
      else voters.delete(userId);
      votes[key] = [...voters];
      return;
    }
    if (post.authorId !== userId) throw new ForbiddenException('POST_OWNER_REQUIRED');
    if (op.type === 'post.edit') {
      if (!op.body.trim() && !post.images?.length && !post.project) throw new BadRequestException('EMPTY_POST');
      post.title = op.title;
      post.body = op.body;
      if (op.html !== undefined) post.html = op.html;
      else delete post.html;
    }
    if (op.type === 'post.update')
      (post.updates ||= []).push({ body: op.body, createdAt: Date.now() });
    if (op.type === 'post.sold') {
      if (post.community !== 'market') throw new BadRequestException('MARKET_POST_REQUIRED');
      post.sold = op.value;
    }
    if (op.type === 'post.accept') {
      if (post.community !== 'questions') throw new BadRequestException('QUESTION_REQUIRED');
      if (op.replyId && !content.comments[post.id]?.some((reply) => reply.id === op.replyId))
        throw new NotFoundException('REPLY_NOT_FOUND');
      if (op.replyId) post.best = op.replyId;
      else delete post.best;
      if (post.wikiRef?.answerId !== post.best) delete post.wikiRef;
    }
    if (op.type === 'post.wiki') {
      if (
        op.wikiId &&
        !content.wiki.some((w) => w.id === op.wikiId && w.communities.includes(post.community))
      )
        throw new BadRequestException('INVALID_WIKI');
      if (op.wikiId)
        post.wikiRef = { id: op.wikiId, ...(post.best ? { answerId: post.best } : {}) };
      else delete post.wikiRef;
    }
  }

  private applyWiki(content: DemoContent, userId: string, name: string, op: DemoOperation) {
    if (op.type === 'wiki.save') {
      let w = content.wiki.find((item) => item.id === op.wiki.id);
      if ((w?.revisions || 0) !== op.baseRevision)
        throw new ConflictException('WIKI_REVISION_CONFLICT');
      const before = w
        ? {
            title: w.title,
            communities: w.communities,
            summary: w.summary,
            sections: w.sections,
            quick: w.quick,
            table: w.table,
            reference: w.reference,
          }
        : { title: '', summary: '', sections: [], quick: [], reference: '' };
      if (!w) {
        w = {
          ...op.wiki,
          slug: op.wiki.id,
          wikiFormat: 1,
          example: false,
          kind: '校园指南',
          scope: '社区共建',
          revisions: 0,
          editor: name,
          updatedAt: '',
          history: [],
          notes: [],
          suggestions: [],
        };
        content.wiki.push(w);
      }
      Object.assign(w, op.wiki);
      for (const suggestion of w.suggestions)
        if (op.applied.includes(String(suggestion['id']))) suggestion['applied'] = true;
      w.revisions++;
      w.editor = name;
      w.editorId = userId;
      w.updatedAt = new Date().toISOString();
      w.history.unshift({
        at: w.updatedAt,
        author: name,
        authorId: userId,
        reason: op.reason,
        before,
        after: op.wiki,
      });
      return;
    }
    if (op.type !== 'wiki.note' && op.type !== 'wiki.suggest') return;
    const w = content.wiki.find((item) => item.id === op.wikiId);
    if (!w) throw new NotFoundException('WIKI_NOT_FOUND');
    const entry = {
      id: op.type === 'wiki.suggest' && op.id ? op.id : randomUUID(),
      author: name,
      authorId: userId,
      text: op.text,
      at: new Date().toISOString(),
    };
    if (w.suggestions.some((item) => item['id'] === entry.id))
      throw new ConflictException('SUGGESTION_EXISTS');
    if (op.type === 'wiki.note') w.notes.push(entry);
    else {
      const section = w.sections[op.index];
      if (!section) throw new BadRequestException('SECTION_NOT_FOUND');
      w.suggestions.push({
        ...entry,
        index: op.index,
        section: section.h,
        reference: op.reference,
        applied: false,
      });
    }
  }
}
