import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type {
  BrowserAccountState,
  BrowserAccount,
} from '../../../../../packages/contracts/src/browser-accounts.js';
import type { AuthResult } from './password-auth.service.js';
import { PasswordAuthService } from './password-auth.service.js';
import { sessionDigest } from './browser-session-state.js';
import { moderationAccess } from '../admin/scope.js';
import { requireCapability } from '../admin/restrictions.js';
import { communitySlug } from '../../../../../packages/contracts/src/boards.js';
type SetRow = Selectable<Database['browser_login_sets']>;
type Grant = Selectable<Database['browser_remembered_logins']>;
export type BrowserReply = {
  deviceToken: string;
  deviceExpiresAt: string;
  auth: AuthResult | null;
  clearSession: boolean;
  state: BrowserAccountState;
};
export class BrowserAccountService {
  constructor(private readonly db: Kysely<Database>) {}
  private async findDevice(secret: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
    return (
      (await this.db
        .selectFrom('browser_login_sets')
        .selectAll()
        .where('secret_hash', '=', sessionDigest(secret))
        .where('expires_at', '>', new Date())
        .executeTakeFirst()) ?? null
    );
  }
  private async device(secret: string) {
    const old = await this.findDevice(secret);
    if (old) return { set: old, secret };
    const next = randomBytes(32).toString('base64url'),
      set = {
        id: randomUUID(),
        secret_hash: sessionDigest(next),
        version: 0,
        current_user_id: null,
        expires_at: new Date(Date.now() + 30 * 86400000),
      };
    await this.db.insertInto('browser_login_sets').values(set).execute();
    return { set, secret: next };
  }
  private async locked(secret: string, expectedVersion: number | undefined) {
    const set = await this.findDevice(secret);
    if (!set) throw new UnauthorizedException('BROWSER_DEVICE_EXPIRED');
    const locked = await this.db
      .selectFrom('browser_login_sets')
      .selectAll()
      .where('id', '=', set.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (locked.version !== expectedVersion) throw new ConflictException('BROWSER_CONTEXT_CHANGED');
    return locked;
  }
  private async status(grant: Grant): Promise<BrowserAccount['status']> {
    const [anchor, user] = await Promise.all([
      this.db
        .selectFrom('sessions')
        .select(['expires_at', 'browser_anchor'])
        .where('id', '=', grant.anchor_session_id)
        .executeTakeFirst(),
      this.db
        .selectFrom('users')
        .select(['kind', 'deleted_at', 'merged_into'])
        .where('id', '=', grant.user_id)
        .executeTakeFirst(),
    ]);
    if (!user || user.deleted_at || user.merged_into || user.kind !== 'member') return 'blocked';
    if (!anchor?.browser_anchor || anchor.expires_at <= new Date()) return 'expired';
    try {
      await requireCapability(this.db, grant.user_id, 'suspension');
    } catch (error) {
      if (error instanceof ForbiddenException) return 'blocked';
      throw error;
    }
    return 'ready';
  }
  private async state(
    set: SetRow,
    token: string | undefined,
    verifiedActor?: AuthResult['actor'],
  ): Promise<BrowserAccountState> {
    const [actor, grants] = await Promise.all([
      verifiedActor ?? new PasswordAuthService(this.db).optionalActor(token || undefined, true),
      this.db
        .selectFrom('browser_remembered_logins')
        .selectAll()
        .where('set_id', '=', set.id)
        .orderBy('last_used_at', 'desc')
        .orderBy('id')
        .execute(),
    ]);
    const accounts = await Promise.all(
      grants.map(async (grant): Promise<BrowserAccount> => {
        const [user, access, status] = await Promise.all([
          this.db
            .selectFrom('users')
            .select(['handle', 'nickname'])
            .where('id', '=', grant.user_id)
            .executeTakeFirst(),
          moderationAccess(this.db, grant.user_id),
          this.status(grant),
        ]);
        let roleLabel = access.admin ? '管理员' : '普通用户';
        const scoped =
          access.boards.find((b) => b.role === 'moderator') ??
          access.boards.find((b) => b.role === 'assistant') ??
          access.boards[0];
        if (!access.admin && scoped) {
          const c = await this.db
            .selectFrom('communities')
            .select('name')
            .where('slug', '=', communitySlug(scoped.board))
            .executeTakeFirst();
          roleLabel =
            (scoped.role === 'moderator'
              ? '版主'
              : scoped.role === 'assistant'
                ? '助手'
                : '管理成员') +
            ' · ' +
            (c?.name ?? scoped.board);
        }
        return {
          id: grant.id,
          userId: grant.user_id,
          username: user?.handle ?? '已停用账号',
          nickname: user?.nickname ?? '已停用账号',
          roleLabel,
          status,
        };
      }),
    );
    return {
      deviceId: set.id,
      version: set.version,
      currentUserId: token === undefined ? set.current_user_id : (actor?.userId ?? null),
      accounts,
    };
  }
  private async reply(
    set: SetRow,
    secret: string,
    token: string | undefined,
    auth: AuthResult | null = null,
    clearSession = false,
  ): Promise<BrowserReply> {
    return {
      deviceToken: secret,
      deviceExpiresAt: set.expires_at.toISOString(),
      auth,
      clearSession,
      // rotate already authenticated this exact token in the same transaction.
      state: await this.state(set, token, auth?.actor),
    };
  }
  async list(secret: string, currentToken: string) {
    const d = await this.device(secret);
    return this.reply(d.set, d.secret, currentToken);
  }
  // Bind the active account/version without rebuilding every remembered user's
  // permission graph. The picker loads its richer account list separately.
  async context(secret: string, currentToken: string): Promise<BrowserReply> {
    const d = await this.device(secret);
    const actor = currentToken ? await new PasswordAuthService(this.db).authenticate(currentToken, true) : null;
    return { deviceToken: d.secret, deviceExpiresAt: d.set.expires_at.toISOString(),
      auth: null, clearSession: false,
      state: { deviceId: d.set.id, version: d.set.version, currentUserId: actor?.userId ?? null, accounts: [] } };
  }
  async remember(
    secret: string,
    verifiedToken: string,
    expectedVersion?: number,
  ): Promise<BrowserReply> {
    const actor = await new PasswordAuthService(this.db).authenticate(verifiedToken, true);
    if (actor.kind !== 'member') throw new BadRequestException('MEMBER_ACCOUNT_REQUIRED');
    return this.db
      .transaction()
      .setIsolationLevel('read committed')
      .execute(async (tx) => {
        const service = new BrowserAccountService(tx);
        const known = await service.findDevice(secret);
        const d = known
          ? { set: await service.locked(secret, expectedVersion), secret }
          : await service.device('');
        const proof = await tx
          .selectFrom('sessions')
          .selectAll()
          .where('token_hash', '=', sessionDigest(verifiedToken))
          .where('expires_at', '>', new Date())
          .forUpdate()
          .executeTakeFirst();
        if (!proof || proof.browser_anchor) throw new UnauthorizedException('AUTH_REQUIRED');
        if (!proof.id) {
          proof.id = randomUUID();
          await tx
            .updateTable('sessions')
            .set({ id: proof.id })
            .where('token_hash', '=', sessionDigest(verifiedToken))
            .execute();
        }
        let grant = await tx
          .selectFrom('browser_remembered_logins')
          .selectAll()
          .where('set_id', '=', d.set.id)
          .where('user_id', '=', actor.userId)
          .executeTakeFirst();
        if (!grant) {
          const count = await tx
            .selectFrom('browser_remembered_logins')
            .select('id')
            .where('set_id', '=', d.set.id)
            .execute();
          if (count.length >= 5) throw new ConflictException('BROWSER_ACCOUNT_LIMIT');
          grant = {
            id: randomUUID(),
            set_id: d.set.id,
            user_id: actor.userId,
            anchor_session_id: proof.id!,
            last_used_at: new Date(),
          };
          await tx.insertInto('browser_remembered_logins').values(grant).execute();
        } else if (!proof.browser_login_id) {
          await tx.deleteFrom('sessions').where('id', '=', grant.anchor_session_id).execute();
          grant = { ...grant, anchor_session_id: proof.id! };
          await tx
            .updateTable('browser_remembered_logins')
            .set({ anchor_session_id: proof.id! })
            .where('id', '=', grant.id)
            .execute();
        } else if (proof.browser_login_id !== grant.id)
          throw new BadRequestException('INDEPENDENT_LOGIN_REQUIRED');
        if (!proof.browser_login_id)
          await tx
            .updateTable('sessions')
            .set({ browser_anchor: 1 })
            .where('token_hash', '=', sessionDigest(verifiedToken))
            .execute();
        const set = {
          ...d.set,
          expires_at: new Date(Math.max(d.set.expires_at.getTime(), proof.expires_at.getTime())),
        };
        await tx
          .updateTable('browser_login_sets')
          .set({ expires_at: set.expires_at })
          .where('id', '=', set.id)
          .execute();
        return service.rotate(set, d.secret, grant);
      });
  }
  private async rotate(set: SetRow, secret: string, grant: Grant) {
    const anchor = await this.db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', grant.anchor_session_id)
      .forUpdate()
      .executeTakeFirst();
    if (!anchor || !anchor.browser_anchor || anchor.expires_at <= new Date())
      throw new UnauthorizedException('BROWSER_LOGIN_EXPIRED');
    const grants = await this.db
      .selectFrom('browser_remembered_logins')
      .selectAll()
      .where('set_id', '=', set.id)
      .execute();
    const ids = grants.map((g) => g.id);
    const children = ids.length
      ? await this.db
          .selectFrom('sessions')
          .select(['browser_login_id', 'authenticated_at'])
          .where('browser_login_id', 'in', ids)
          .execute()
      : [];
    for (const child of children) {
      const parent = grants.find((g) => g.id === child.browser_login_id);
      if (parent && child.authenticated_at)
        await this.db
          .updateTable('sessions')
          .set({ authenticated_at: child.authenticated_at })
          .where('id', '=', parent.anchor_session_id)
          .where((eb) =>
            eb.or([
              eb('authenticated_at', 'is', null),
              eb('authenticated_at', '<', child.authenticated_at!),
            ]),
          )
          .execute();
    }
    if (ids.length)
      await this.db.deleteFrom('sessions').where('browser_login_id', 'in', ids).execute();
    const freshAnchor = await this.db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', grant.anchor_session_id)
      .executeTakeFirstOrThrow();
    const version = set.version + 1,
      token = randomBytes(32).toString('base64url');
    await this.db
      .insertInto('sessions')
      .values({
        id: randomUUID(),
        token_hash: sessionDigest(token),
        user_id: grant.user_id,
        device: freshAnchor.device,
        created_at: freshAnchor.created_at,
        last_seen_at: new Date(),
        expires_at: freshAnchor.expires_at,
        authenticated_at: freshAnchor.authenticated_at,
        browser_anchor: 0,
        browser_login_id: grant.id,
        browser_version: version,
      })
      .execute();
    const next = { ...set, version, current_user_id: grant.user_id };
    await this.db
      .updateTable('browser_login_sets')
      .set({ version, current_user_id: grant.user_id })
      .where('id', '=', set.id)
      .execute();
    await this.db
      .updateTable('browser_remembered_logins')
      .set({ last_used_at: new Date() })
      .where('id', '=', grant.id)
      .execute();
    const actor = await new PasswordAuthService(this.db).authenticate(token, true);
    return this.reply(next, secret, token, {
      actor,
      token,
      expiresAt: freshAnchor.expires_at.toISOString(),
    });
  }
  async switch(secret: string, accountId: string, expectedVersion: number) {
    return this.db
      .transaction()
      .setIsolationLevel('read committed')
      .execute(async (tx) => {
        const s = new BrowserAccountService(tx),
          set = await s.locked(secret, expectedVersion);
        const grant = await tx
          .selectFrom('browser_remembered_logins')
          .selectAll()
          .where('set_id', '=', set.id)
          .where('id', '=', accountId)
          .executeTakeFirst();
        if (!grant) throw new ForbiddenException('BROWSER_ACCOUNT_NOT_SAVED');
        const status = await s.status(grant);
        if (status !== 'ready')
          throw new UnauthorizedException(
            status === 'blocked' ? 'BROWSER_ACCOUNT_BLOCKED' : 'BROWSER_LOGIN_EXPIRED',
          );
        return s.rotate(set, secret, grant);
      });
  }
  async remove(secret: string, accountId: string, expectedVersion: number) {
    return this.db
      .transaction()
      .setIsolationLevel('read committed')
      .execute(async (tx) => {
        const s = new BrowserAccountService(tx),
          set = await s.locked(secret, expectedVersion);
        const grant = await tx
          .selectFrom('browser_remembered_logins')
          .selectAll()
          .where('set_id', '=', set.id)
          .where('id', '=', accountId)
          .executeTakeFirst();
        if (!grant) throw new ForbiddenException('BROWSER_ACCOUNT_NOT_SAVED');
        await tx.deleteFrom('sessions').where('id', '=', grant.anchor_session_id).execute();
        await tx.deleteFrom('sessions').where('browser_login_id', '=', grant.id).execute();
        await tx.deleteFrom('browser_remembered_logins').where('id', '=', grant.id).execute();
        const currentRemoved = set.current_user_id === grant.user_id;
        const next = {
          ...set,
          version: set.version + (currentRemoved ? 1 : 0),
          current_user_id: currentRemoved ? null : set.current_user_id,
        };
        await tx
          .updateTable('browser_login_sets')
          .set({ version: next.version, current_user_id: next.current_user_id })
          .where('id', '=', set.id)
          .execute();
        return s.reply(next, secret, currentRemoved ? '' : undefined, null, currentRemoved);
      });
  }
  async logoutAll(secret: string, expectedVersion: number) {
    return this.db
      .transaction()
      .setIsolationLevel('read committed')
      .execute(async (tx) => {
        const s = new BrowserAccountService(tx),
          set = await s.locked(secret, expectedVersion);
        const grants = await tx
          .selectFrom('browser_remembered_logins')
          .selectAll()
          .where('set_id', '=', set.id)
          .execute();
        for (const g of grants) {
          await tx.deleteFrom('sessions').where('id', '=', g.anchor_session_id).execute();
          await tx.deleteFrom('sessions').where('browser_login_id', '=', g.id).execute();
        }
        await tx.deleteFrom('browser_remembered_logins').where('set_id', '=', set.id).execute();
        const next = { ...set, version: set.version + 1, current_user_id: null };
        await tx
          .updateTable('browser_login_sets')
          .set({ version: next.version, current_user_id: null })
          .where('id', '=', set.id)
          .execute();
        return s.reply(next, secret, '', null, true);
      });
  }
}
