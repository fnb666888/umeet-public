import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import {
  AccountProfileInput,
  type AccountOverview,
} from '../../../../../packages/contracts/src/account.js';
import { PasswordAuthService } from './password-auth.service.js';
import { AuditService } from '../audit/audit.service.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const identityKey = (provider: string, subject: string) =>
  provider.startsWith('wechat-') ? 'wechat' : digest(JSON.stringify([provider, subject]));

export class AccountService {
  private readonly auth: PasswordAuthService;
  constructor(private readonly db: Kysely<Database>) {
    this.auth = new PasswordAuthService(db);
  }
  async overview(token: string): Promise<AccountOverview> {
    const actor = await this.auth.authenticate(token, true);
    if (actor.kind !== 'member') throw new BadRequestException('REGISTERED_ACCOUNT_REQUIRED');
    const [user, identities, password, sessions, events] = await Promise.all([
      this.db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', actor.userId)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('external_identities')
        .selectAll()
        .where('user_id', '=', actor.userId)
        .execute(),
      this.db
        .selectFrom('password_credentials')
        .select('username')
        .where('user_id', '=', actor.userId)
        .executeTakeFirst(),
      this.db
        .selectFrom('sessions')
        .selectAll()
        .where('user_id', '=', actor.userId)
        .where('expires_at', '>', new Date())
        .orderBy('last_seen_at', 'desc')
        .execute(),
      this.db
        .selectFrom('audit_events')
        .select(['id', 'kind', 'created_at'])
        .where('actor_id', '=', actor.userId)
        .where('kind', 'like', 'identity.%')
        .orderBy('created_at', 'desc')
        .limit(20)
        .execute(),
    ]);
    const current = sessions.find((session) => session.token_hash === digest(token));
    const currentGrant = current?.browser_login_id
      ? await this.db.selectFrom('browser_remembered_logins').select('anchor_session_id').where('id', '=', current.browser_login_id).executeTakeFirst()
      : null;
    for (const session of sessions) {
      if (!session.id) {
        const id = randomUUID();
        await this.db
          .updateTable('sessions')
          .set({ id })
          .where('token_hash', '=', session.token_hash)
          .where('id', 'is', null)
          .execute();
        const stored = await this.db
          .selectFrom('sessions')
          .select('id')
          .where('token_hash', '=', session.token_hash)
          .executeTakeFirst();
        session.id = stored?.id || id;
      }
    }
    return {
      userId: user.id,
      handle: user.handle,
      nickname: user.nickname,
      usernameChangesRemaining: Math.max(0, 1 - user.username_changes),
      needsOnboarding: !user.onboarded_at,
      requiresReauthentication:
        !current?.authenticated_at || Date.now() - current.authenticated_at.getTime() > 600000,
      hasPassword: !!password,
      passwordUsername: password?.username || null,
      securityEvents: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        createdAt: event.created_at.toISOString(),
      })),
      identities: [
        ...new Map(
          identities.map((identity) => {
            const key = identityKey(identity.provider, identity.subject);
            return [
              key,
              {
                key,
                provider: identity.provider.startsWith('wechat-') ? 'wechat' : identity.provider,
                label:
                  identity.provider === 'email'
                    ? identity.subject
                    : identity.provider.startsWith('wechat-')
                      ? '微信'
                      : identity.provider === 'sms'
                        ? '手机尾号 ' + identity.subject.slice(-4)
                        : '其他登录方式',
                ...(identity.provider === 'email' ? { email: identity.subject } : {}),
              },
            ];
          }),
        ).values(),
      ],
      sessions: sessions.filter(session => !session.browser_login_id).map((session) => ({
        id: session.id!,
        device: session.device,
        current: session.token_hash === digest(token) || session.id === currentGrant?.anchor_session_id,
        createdAt: session.created_at.toISOString(),
        lastSeenAt: session.last_seen_at.toISOString(),
        expiresAt: session.expires_at.toISOString(),
      })),
    };
  }
  async profile(token: string, raw: unknown) {
    const actorForRestriction = await this.auth.authenticate(token);
    const { requireCapability } = await import('../admin/restrictions.js');
    await requireCapability(this.db, actorForRestriction.userId, 'profile');
    const parsed = AccountProfileInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('INVALID_INPUT');
    const { handle } = parsed.data;
    try {
      await this.db.transaction().execute(async (tx) => {
        // Use the same lock order as community profile updates.
        await tx
          .selectFrom('demo_content')
          .select('id')
          .where('id', '=', 'global')
          .forUpdate()
          .executeTakeFirstOrThrow();
        const actor = await this.auth.requireRecentMember(token, tx);
        await requireCapability(tx, actor.userId, 'profile');
        const user = await tx
          .selectFrom('users')
          .selectAll()
          .where('id', '=', actor.userId)
          .executeTakeFirstOrThrow();
        if (user.handle === handle) return;
        if (user.username_changes >= 1) throw new ConflictException('USERNAME_CHANGE_LIMIT');
        const reserved = await tx
          .selectFrom('password_credentials')
          .select('user_id')
          .where('username', '=', handle)
          .executeTakeFirst();
        if (reserved && reserved.user_id !== actor.userId)
          throw new ConflictException('HANDLE_UNAVAILABLE');
        await tx
          .updateTable('users')
          .set({
            handle,
            nickname: handle,
            username_changes: user.username_changes + 1,
            onboarded_at: new Date(),
          })
          .where('id', '=', actor.userId)
          .execute();
        const stored = await tx
          .selectFrom('demo_user_states')
          .select('data')
          .where('user_id', '=', actor.userId)
          .forUpdate()
          .executeTakeFirst();
        if (stored) {
          const state = JSON.parse(stored.data) as { profile?: { name: string } };
          if (state.profile) state.profile.name = handle;
          await tx
            .updateTable('demo_user_states')
            .set({ data: JSON.stringify(state), updated_at: new Date() })
            .where('user_id', '=', actor.userId)
            .execute();
        }
        await tx
          .updateTable('password_credentials')
          .set({ username: handle })
          .where('user_id', '=', actor.userId)
          .execute();
        await new AuditService().append(tx, {
          actorId: actor.userId,
          kind: 'identity.profile-completed',
          targetId: actor.userId,
          reason: 'Account handle and display name confirmed',
        });
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY')
        throw new ConflictException('HANDLE_UNAVAILABLE');
      throw error;
    }
    return this.overview(token);
  }
  async unlink(token: string, key: string) {
    await this.db.transaction().execute(async (tx) => {
      const actor = await this.auth.requireRecentMember(token, tx);
      const identities = await tx
        .selectFrom('external_identities')
        .selectAll()
        .where('user_id', '=', actor.userId)
        .forUpdate()
        .execute();
      const targets = identities.filter(
        (identity) => identityKey(identity.provider, identity.subject) === key,
      );
      if (!targets.length) throw new NotFoundException('IDENTITY_NOT_FOUND');
      const password = await tx
        .selectFrom('password_credentials')
        .select('username')
        .where('user_id', '=', actor.userId)
        .executeTakeFirst();
      if (targets.length === identities.length && !password)
        throw new ConflictException('LAST_LOGIN_METHOD');
      if (
        targets.some((identity) => identity.provider === 'email') &&
        !password &&
        !identities.some((identity) => identity.provider === 'email' && !targets.includes(identity))
      )
        throw new ConflictException('LAST_WEB_LOGIN_METHOD');
      for (const target of targets)
        await tx
          .deleteFrom('external_identities')
          .where('user_id', '=', actor.userId)
          .where('provider', '=', target.provider)
          .where('subject', '=', target.subject)
          .execute();
      const currentAnchor = await this.currentAnchor(tx, token);
      let others = tx
        .deleteFrom('sessions')
        .where('user_id', '=', actor.userId)
        .where('token_hash', '!=', digest(token));
      if (currentAnchor) others = others.where(eb => eb.or([eb('id', 'is', null), eb('id', '!=', currentAnchor)]));
      await others.execute();
      await new AuditService().append(tx, {
        actorId: actor.userId,
        kind: 'identity.unlinked',
        targetId: actor.userId,
        reason: 'Login method removed after recent authentication; other sessions revoked',
      });
    });
    return { ok: true };
  }
  async revoke(token: string, id: string) {
    return this.db.transaction().execute(async (tx) => {
      const actor = await this.auth.requireRecentMember(token, tx, new Date(), true);
      let query = tx.deleteFrom('sessions').where('user_id', '=', actor.userId);
      if (id === 'others') {
        query = query.where('token_hash', '!=', digest(token));
        const anchor = await this.currentAnchor(tx, token);
        if (anchor) query = query.where(eb => eb.or([eb('id', 'is', null), eb('id', '!=', anchor)]));
      } else {
        const target = await tx.selectFrom('sessions').select('browser_login_id').where('id', '=', id).where('user_id', '=', actor.userId).executeTakeFirst();
        const grant = target?.browser_login_id ? await tx.selectFrom('browser_remembered_logins').select('anchor_session_id').where('id', '=', target.browser_login_id).executeTakeFirst() : null;
        query = query.where('id', '=', grant?.anchor_session_id ?? id);
      }
      await query.execute();
      await new AuditService().append(tx, {
        actorId: actor.userId,
        kind: 'identity.sessions-revoked',
        targetId: actor.userId,
        reason: 'Account owner revoked sessions',
      });
      return { ok: true };
    });
  }
  private async currentAnchor(db: Kysely<Database>, token: string) {
    const session = await db.selectFrom('sessions').select('browser_login_id').where('token_hash', '=', digest(token)).executeTakeFirst();
    if (!session?.browser_login_id) return null;
    return (await db.selectFrom('browser_remembered_logins').select('anchor_session_id').where('id', '=', session.browser_login_id).executeTakeFirst())?.anchor_session_id ?? null;
  }
  async close(token: string) {
    await this.auth.transact(async (tx) => {
      await tx
        .selectFrom('demo_content')
        .select('id')
        .where('id', '=', 'global')
        .forUpdate()
        .executeTakeFirstOrThrow();
      const actor = await this.auth.requireRecentMember(token, tx);
      const owner = await tx.selectFrom('platform_roles').select('user_id').where('user_id', '=', actor.userId).where('role', '=', 'owner').executeTakeFirst();
      if (owner) throw new ConflictException('TRANSFER_SITE_BEFORE_CLOSING');
      const identities = await tx
        .selectFrom('external_identities')
        .selectAll()
        .where('user_id', '=', actor.userId)
        .forUpdate()
        .execute();
      const entities = await tx.selectFrom('demo_entities').selectAll().execute();
      const replyAuthors = new Map<string, string>();
      for (const entity of entities) {
        if (entity.kind !== 'reply') continue;
        const reply = JSON.parse(entity.data) as { id: string; authorId: string; postId: string };
        replyAuthors.set(reply.postId + ':' + reply.id, reply.authorId);
      }
      const anonymize = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(anonymize);
        if (!value || typeof value !== 'object') return value;
        const item = value as Record<string, unknown>;
        const result = Object.fromEntries(
          Object.entries(item).map(([key, child]) => [key, anonymize(child)]),
        );
        if (item.authorId === actor.userId) result.author = '已注销用户';
        if (item.editorId === actor.userId) result.editor = '已注销用户';
        if (
          typeof item.replyTo === 'string' &&
          replyAuthors.get(String(item.postId) + ':' + item.replyTo) === actor.userId
        )
          result.replyToName = '已注销用户';
        return result;
      };
      for (const entity of entities) {
        if (!['post', 'reply', 'wiki'].includes(entity.kind)) continue;
        const data = JSON.stringify(anonymize(JSON.parse(entity.data)));
        if (data !== entity.data)
          await tx.updateTable('demo_entities').set({ data }).where('id', '=', entity.id).execute();
      }
      await tx
        .updateTable('users')
        .set({ nickname: '已注销用户', deleted_at: new Date(), onboarded_at: null })
        .where('id', '=', actor.userId)
        .execute();
      await tx.deleteFrom('sessions').where('user_id', '=', actor.userId).execute();
      await tx.deleteFrom('password_credentials').where('user_id', '=', actor.userId).execute();
      await tx.deleteFrom('external_identities').where('user_id', '=', actor.userId).execute();
      await tx.deleteFrom('demo_user_states').where('user_id', '=', actor.userId).execute();
      await tx.deleteFrom('community_post_bookmarks').where('user_id','=',actor.userId).execute();
      await tx.deleteFrom('personal_records').where('user_id', '=', actor.userId).execute();
      await tx.deleteFrom('platform_roles').where('user_id', '=', actor.userId).execute();
      await tx.deleteFrom('community_roles').where('user_id', '=', actor.userId).execute();
      await tx.deleteFrom('otp_challenges').where('owner_id', '=', actor.userId).execute();
      for (const identity of identities) {
        if (!['email', 'sms'].includes(identity.provider)) continue;
        await tx
          .deleteFrom('otp_challenges')
          .where('channel', '=', identity.provider)
          .where('recipient', '=', identity.subject)
          .execute();
      }
      await tx
        .updateTable('demo_messages')
        .set({ text: '此消息由已注销用户发送', post_id: null })
        .where('sender_id', '=', actor.userId)
        .execute();
      await tx
        .updateTable('demo_content')
        .set((eb) => ({ version: eb('version', '+', 1), updated_at: new Date() }))
        .where('id', '=', 'global')
        .execute();
      await new AuditService().append(tx, {
        actorId: actor.userId,
        targetId: actor.userId,
        kind: 'identity.closed',
        reason: 'Account closed by verified owner; public contributions retained anonymously',
      });
    });
    return { ok: true };
  }
}
