import { generateUsername } from './username.js';
import {assertLiveBrowserSession,revokeAccessSession} from './browser-session-state.js';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { UsernameSchema, type Actor } from '../../../../../packages/contracts/src/index.js';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import {
  UnauthorizedException,
  ConflictException,
  HttpException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { VerifiedLoginProof } from './auth-provider.js';
import { SettingsService } from '../settings/settings.service.js';
import { initializeAnnouncements } from '../settings/registration-policy.js';
const Username = UsernameSchema;
const Password = z.string().min(12).max(128);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
async function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      Buffer.from(salt, 'hex'),
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$32768$8$1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^scrypt\$32768\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(encoded);
  const salt = match?.[1] || '0'.repeat(32),
    expected = Buffer.from(match?.[2] || '0'.repeat(128), 'hex');
  const candidate = await derive(password, salt);
  return timingSafeEqual(candidate, expected) && !!match;
}
export type AuthResult = { actor: Actor; token: string; expiresAt: string };
export type VerifiedProofResolution =
  { proof: VerifiedLoginProof } | { error: UnauthorizedException };
export class PasswordAuthService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly device = '未知设备',
  ) {}
  async consumeOtpRequest(client: string): Promise<void> {
    await this.consume('otp-request:' + client, 20);
  }
  async setPassword(
    token: string,
    input: { username?: string | undefined; password: string },
  ): Promise<AuthResult> {
    await this.requireRecentMember(token);
    const encoded = await hashPassword(Password.parse(input.password));
    try {
      return await this.db.transaction().execute(async (tx) => {
        const actor = await this.requireRecentMember(token, tx);
        const existing = await tx
          .selectFrom('password_credentials')
          .select('username')
          .where('user_id', '=', actor.userId)
          .executeTakeFirst();
        const user = await tx
          .selectFrom('users')
          .select('handle')
          .where('id', '=', actor.userId)
          .executeTakeFirstOrThrow();
        const parsedUsername = Username.safeParse(
          input.username || existing?.username || user.handle || '',
        );
        if (!parsedUsername.success) throw new BadRequestException('HANDLE_REQUIRED');
        const username = parsedUsername.data;
        if (user.handle && username !== (existing?.username || user.handle))
          throw new ConflictException('USERNAME_UNAVAILABLE');
        const reserved = await tx
          .selectFrom('users')
          .select('id')
          .where('handle', '=', username)
          .executeTakeFirst();
        if (reserved && reserved.id !== actor.userId)
          throw new ConflictException('USERNAME_UNAVAILABLE');
        if (!user.handle)
          await tx
            .updateTable('users')
            .set({ handle: username })
            .where('id', '=', actor.userId)
            .execute();
        if (existing)
          await tx
            .updateTable('password_credentials')
            .set({ username, password_hash: encoded })
            .where('user_id', '=', actor.userId)
            .execute();
        else
          await tx
            .insertInto('password_credentials')
            .values({ username, user_id: actor.userId, password_hash: encoded })
            .execute();
        await tx.deleteFrom('sessions').where('user_id', '=', actor.userId).execute();
        await new AuditService().append(tx, {
          actorId: actor.userId,
          kind: 'identity.password-updated',
          targetId: actor.userId,
          reason: 'Password updated after recent authentication; existing sessions revoked',
        });
        return this.issue(tx, actor.userId, 'member');
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY')
        throw new ConflictException('USERNAME_UNAVAILABLE');
      throw error;
    }
  }
  async setVerifiedPassword(
    tx: Transaction<Database>,
    userId: string,
    password: string,
    currentPassword?: string,
  ): Promise<AuthResult> {
    const user = await tx
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (user.deleted_at || user.merged_into || user.kind !== 'member')
      throw new UnauthorizedException('AUTH_REQUIRED');
    const existing = await tx
      .selectFrom('password_credentials')
      .selectAll()
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (
      currentPassword !== undefined &&
      existing &&
      !(await verifyPassword(currentPassword, existing.password_hash))
    )
      throw new UnauthorizedException('CURRENT_PASSWORD_INVALID');
    if (!user.handle) throw new BadRequestException('HANDLE_REQUIRED');
    const encoded = await hashPassword(Password.parse(password));
    if (existing)
      await tx
        .updateTable('password_credentials')
        .set({ password_hash: encoded })
        .where('user_id', '=', userId)
        .execute();
    else
      await tx
        .insertInto('password_credentials')
        .values({ user_id: userId, username: user.handle, password_hash: encoded })
        .execute();
    await tx.deleteFrom('sessions').where('user_id', '=', userId).execute();
    await new AuditService().append(tx, {
      actorId: userId,
      targetId: userId,
      kind: 'identity.password-updated',
      reason: 'Password updated after email verification; previous sessions revoked',
    });
    return this.issue(tx, userId, 'member');
  }
  async listMethods(token: string): Promise<{
    username: string | null;
    emails: string[];
    phones: string[];
    wechat: boolean;
    requiresReauthentication: boolean;
  }> {
    const actor = await this.authenticate(token);
    if (actor.kind !== 'member') throw new ForbiddenException('REGISTERED_ACCOUNT_REQUIRED');
    const [password, identities, session] = await Promise.all([
      this.db
        .selectFrom('password_credentials')
        .select('username')
        .where('user_id', '=', actor.userId)
        .executeTakeFirst(),
      this.db
        .selectFrom('external_identities')
        .select(['provider', 'subject'])
        .where('user_id', '=', actor.userId)
        .execute(),
      this.db
        .selectFrom('sessions')
        .select('authenticated_at')
        .where('token_hash', '=', tokenHash(token))
        .executeTakeFirstOrThrow(),
    ]);
    return {
      username: password?.username || null,
      emails: identities
        .filter((row) => row.provider === 'email')
        .map(
          (row) =>
            row.subject.slice(0, 1) + '***@' + row.subject.slice(row.subject.lastIndexOf('@') + 1),
        ),
      phones: identities
        .filter((row) => row.provider === 'sms')
        .map((row) => '***' + row.subject.slice(-4)),
      wechat: identities.some((row) => row.provider.startsWith('wechat-')),
      requiresReauthentication:
        !session.authenticated_at || Date.now() - session.authenticated_at.getTime() > 600000,
    };
  }
  async consumeExternalAttempt(client: string): Promise<void> {
    await this.consume('external-login:' + client, 100);
  }
  async acceptExternalProof(
    raw: VerifiedLoginProof,
    guestToken?: string,
    transaction?: Transaction<Database>,
  ): Promise<AuthResult> {
    const proof = z
      .strictObject({
        identities: z
          .array(
            z.strictObject({
              provider: z.string().min(1).max(80),
              subject: z.string().min(1).max(254),
            }),
          )
          .min(1)
          .max(4),
        nickname: z.string().trim().min(1).max(40),
      })
      .parse(raw);
    const identities = [
      ...new Map(
        proof.identities.map((identity) => [
          JSON.stringify([identity.provider, identity.subject]),
          identity,
        ]),
      ).values(),
    ];
    const execute = async (tx: Transaction<Database>) => {
      const existing = await tx
        .selectFrom('external_identities')
        .select(['user_id', 'provider', 'subject'])
        .where((eb) =>
          eb.or(
            identities.map((identity) =>
              eb.and([
                eb('provider', '=', identity.provider),
                eb('subject', '=', identity.subject),
              ]),
            ),
          ),
        )
        .execute();
      const mappedUsers = new Set(existing.map((identity) => identity.user_id));
      if (mappedUsers.size > 1) throw new ConflictException('IDENTITY_ACCOUNT_CONFLICT');
      const guestId = guestToken ? await this.lockGuest(tx, guestToken) : undefined;
      let userId = existing[0]?.user_id;
      let registered = !userId;
      if (registered && (await new SettingsService(tx).getSiteSettings()).settings.registration.mode !== 'open')
        throw new ForbiddenException('REGISTRATION_USE_EMAIL');
      if (userId) {
        const user = await tx
          .selectFrom('users')
          .selectAll()
          .where('id', '=', userId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (user.merged_into || user.deleted_at)
          throw new ConflictException('IDENTITY_ACCOUNT_CONFLICT');
        if (guestToken && guestId !== userId) await this.mergeGuest(tx, guestToken, userId);
        if (user.kind === 'guest') {
          if ((await new SettingsService(tx).getSiteSettings()).settings.registration.mode !== 'open')
            throw new ForbiddenException('REGISTRATION_USE_EMAIL');
          registered = true;
          const handle = user.handle || (await generateUsername(tx));
          await tx
            .updateTable('users')
            .set({ kind: 'member', handle, nickname: handle, onboarded_at: new Date() })
            .where('id', '=', userId)
            .execute();
          await tx.deleteFrom('sessions').where('user_id', '=', userId).execute();
        }
      } else if (guestId) {
        userId = guestId;
        const handle = await generateUsername(tx);
        await tx
          .updateTable('users')
          .set({ kind: 'member', nickname: handle, handle, onboarded_at: new Date() })
          .where('id', '=', userId)
          .execute();
        await tx.deleteFrom('sessions').where('user_id', '=', userId).execute();
      } else {
        userId = randomUUID();
        const handle = await generateUsername(tx);
        await tx
          .insertInto('users')
          .values({
            id: userId,
            kind: 'member',
            nickname: handle,
            handle,
            onboarded_at: new Date(),
          })
          .execute();
      }
      if (registered) await initializeAnnouncements(tx, userId);
      for (const identity of identities)
        if (
          !existing.some(
            (row) => row.provider === identity.provider && row.subject === identity.subject,
          )
        )
          await tx
            .insertInto('external_identities')
            .values({ ...identity, user_id: userId })
            .execute();
      await new AuditService().append(tx, {
        actorId: userId,
        kind: 'identity.external-login',
        targetId: userId,
        reason: 'Identity proof verified by configured external provider',
      });
      return this.issue(tx, userId, 'member');
    };
    return transaction ? execute(transaction) : this.transact(execute);
  }
  async transact<T>(work: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.transaction().execute(work);
      } catch (error) {
        const retryable =
          error &&
          typeof error === 'object' &&
          'code' in error &&
          ['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK'].includes(String(error.code));
        if (!retryable || attempt === 2) throw error;
      }
    }
    throw new Error('IDENTITY_RETRY_EXHAUSTED');
  }
  async withVerifiedProof(
    verify: (tx: Transaction<Database>) => Promise<VerifiedProofResolution>,
    guestToken?: string,
  ): Promise<AuthResult> {
    const outcome = await this.transact(async (tx) => {
      const proof = await verify(tx);
      if ('error' in proof) return proof;
      return { result: await this.acceptExternalProof(proof.proof, guestToken, tx) };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.result;
  }
  async requireRecentMember(
    token: string,
    transaction?: Transaction<Database>,
    now = new Date(),
    allowSuspended = false,
  ): Promise<Actor> {
    if (!transaction) return this.transact((tx) => this.requireRecentMember(token, tx, now, allowSuspended));
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('AUTH_REQUIRED');
    await assertLiveBrowserSession(transaction,token);
    const session = await transaction
      .selectFrom('sessions')
      .selectAll()
      .where('token_hash', '=', tokenHash(token))
      .where('expires_at', '>', now)
      .executeTakeFirst();
    if (!session) throw new UnauthorizedException('AUTH_REQUIRED');
    const user = await transaction
      .selectFrom('users')
      .selectAll()
      .where('id', '=', session.user_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (user.merged_into || user.deleted_at) throw new UnauthorizedException('AUTH_REQUIRED');
    if (user.kind !== 'member') throw new ForbiddenException('REGISTERED_ACCOUNT_REQUIRED');
    const { requireCapability } = await import('../admin/restrictions.js');
    if (!allowSuspended) await requireCapability(transaction, user.id, 'suspension');
    if (!session.authenticated_at || now.getTime() - session.authenticated_at.getTime() > 600000)
      throw new ForbiddenException('REAUTHENTICATION_REQUIRED');
    const current = await transaction
      .selectFrom('sessions')
      .select('token_hash')
      .where('token_hash', '=', session.token_hash)
      .where('expires_at', '>', now)
      .forUpdate()
      .executeTakeFirst();
    if (!current) throw new UnauthorizedException('AUTH_REQUIRED');
    const roles = await transaction
      .selectFrom('platform_roles')
      .select('role')
      .where('user_id', '=', user.id)
      .execute();
    return { userId: user.id, kind: 'member', platformRoles: roles.map((row) => row.role) };
  }
  async withVerifiedLink(
    verify: (tx: Transaction<Database>, actor: Actor) => Promise<VerifiedProofResolution>,
    memberToken: string,
    now = new Date(),
  ): Promise<{ linked: true }> {
    const outcome = await this.transact(async (tx) => {
      const actor = await this.requireRecentMember(memberToken, tx, now),
        resolution = await verify(tx, actor);
      if ('error' in resolution) return resolution;
      for (const identity of resolution.proof.identities) {
        const existing = await tx
          .selectFrom('external_identities')
          .select('user_id')
          .where('provider', '=', identity.provider)
          .where('subject', '=', identity.subject)
          .forUpdate()
          .executeTakeFirst();
        if (existing && existing.user_id !== actor.userId)
          throw new ConflictException('IDENTITY_ACCOUNT_CONFLICT');
        if (!existing)
          await tx
            .insertInto('external_identities')
            .values({ ...identity, user_id: actor.userId })
            .execute();
      }
      await new AuditService().append(tx, {
        actorId: actor.userId,
        kind: 'identity.linked',
        targetId: actor.userId,
        reason: 'Recently authenticated account and new identity both verified',
      });
      return { linked: true as const };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome;
  }
  private async consume(key: string, limit = 5): Promise<void> {
    const hash = tokenHash(key),
      now = new Date(),
      expiry = new Date(now.getTime() + 300000);
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('auth_attempts')
        .values({ key_hash: hash, attempts: 0, expires_at: expiry })
        .onDuplicateKeyUpdate({ key_hash: hash })
        .execute();
      const row = await tx
        .selectFrom('auth_attempts')
        .selectAll()
        .where('key_hash', '=', hash)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (row.expires_at > now && row.attempts >= limit)
        throw new HttpException('TOO_MANY_ATTEMPTS', 429);
      await tx
        .updateTable('auth_attempts')
        .set({
          attempts: row.expires_at <= now ? 1 : row.attempts + 1,
          expires_at: row.expires_at <= now ? expiry : row.expires_at,
        })
        .where('key_hash', '=', hash)
        .execute();
    });
  }
  private async issue(
    tx: Transaction<Database>,
    userId: string,
    kind: 'guest' | 'member',
  ): Promise<AuthResult> {
    const user = await tx
      .selectFrom('users')
      .select(['merged_into', 'deleted_at'])
      .where('id', '=', userId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (user.merged_into || user.deleted_at) throw new UnauthorizedException('AUTH_REQUIRED');
    const token = randomBytes(32).toString('base64url'),
      expiresAt = new Date(Date.now() + (kind === 'guest' ? 7 : 30) * 86400000);
    await tx
      .insertInto('sessions')
      .values({
        token_hash: tokenHash(token),
        id: randomUUID(),
        device: this.device.slice(0, 240),
        created_at: new Date(),
        last_seen_at: new Date(),
        user_id: userId,
        expires_at: expiresAt,
        authenticated_at: kind === 'member' ? new Date() : null,
      })
      .execute();
    const roles = await tx
      .selectFrom('platform_roles')
      .select('role')
      .where('user_id', '=', userId)
      .execute();
    return {
      actor: { userId, kind, platformRoles: roles.map((r) => r.role) },
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }
  private async lockGuest(tx: Transaction<Database>, token: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('AUTH_REQUIRED');
    const session = await tx
      .selectFrom('sessions')
      .select('user_id')
      .where('token_hash', '=', tokenHash(token))
      .executeTakeFirst();
    if (!session) throw new UnauthorizedException('AUTH_REQUIRED');
    const user = await tx
      .selectFrom('users')
      .select(['id', 'kind', 'merged_into', 'deleted_at'])
      .where('id', '=', session.user_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const current = await tx
      .selectFrom('sessions')
      .select('token_hash')
      .where('token_hash', '=', tokenHash(token))
      .where('expires_at', '>', new Date())
      .forUpdate()
      .executeTakeFirst();
    if (!current) throw new UnauthorizedException('AUTH_REQUIRED');
    if (user.merged_into || user.deleted_at) throw new UnauthorizedException('AUTH_REQUIRED');
    if (user.kind !== 'guest') throw new ConflictException('ALREADY_REGISTERED');
    return user.id;
  }
  private async mergeGuest(
    tx: Transaction<Database>,
    token: string,
    memberId: string,
  ): Promise<void> {
    const guestId = await this.lockGuest(tx, token);
    // A successful password check proves the destination account. Only the held guest
    // session proves the source; no user ID supplied by a client is accepted.
    await tx
      .selectFrom('users')
      .select('id')
      .where('id', '=', memberId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const records = await tx
      .selectFrom('personal_records')
      .selectAll()
      .where('user_id', '=', guestId)
      .forUpdate()
      .execute();
    for (const record of records) {
      const existing = await tx
        .selectFrom('personal_records')
        .selectAll()
        .where('user_id', '=', memberId)
        .where('kind', '=', record.kind)
        .where('record_key', '=', record.record_key)
        .executeTakeFirst();
      if (!existing)
        await tx
          .insertInto('personal_records')
          .values({ ...record, user_id: memberId })
          .execute();
      else if (record.kind === 'draft' && existing.value !== record.value)
        await tx
          .insertInto('personal_records')
          .values({
            ...record,
            user_id: memberId,
            record_key: record.record_key.slice(0, 120) + '~' + randomUUID(),
          })
          .execute();
      else if (record.kind === 'history' && record.updated_at > existing.updated_at)
        await tx
          .updateTable('personal_records')
          .set({ value: record.value, updated_at: record.updated_at })
          .where('user_id', '=', memberId)
          .where('kind', '=', record.kind)
          .where('record_key', '=', record.record_key)
          .execute();
    }
    await tx.deleteFrom('personal_records').where('user_id', '=', guestId).execute();
    await tx.deleteFrom('sessions').where('user_id', '=', guestId).execute();
    await tx
      .updateTable('users')
      .set({ merged_into: memberId })
      .where('id', '=', guestId)
      .execute();
    await new AuditService().append(tx, {
      actorId: memberId,
      kind: 'identity.guest-merged',
      targetId: guestId,
      reason: 'Guest session and existing account password both verified',
    });
  }
  async register(
    input: { username: string; password: string; guestToken?: string },
    client: string,
    transaction?: Transaction<Database>,
  ): Promise<AuthResult> {
    const username = Username.parse(input.username),
      password = Password.parse(input.password);
    if (!transaction) await this.consume('register:' + client, 20);
    const encoded = await hashPassword(password);
    try {
      const execute = async (tx: Transaction<Database>) => {
        const userId = input.guestToken ? await this.lockGuest(tx, input.guestToken) : randomUUID();
        if (input.guestToken) {
          await tx
            .updateTable('users')
            .set({ kind: 'member', nickname: username, handle: username, onboarded_at: new Date() })
            .where('id', '=', userId)
            .execute();
          await tx.deleteFrom('sessions').where('user_id', '=', userId).execute();
          await new AuditService().append(tx, {
            actorId: userId,
            kind: 'identity.upgraded',
            targetId: userId,
            reason: 'Guest registered password credentials',
          });
        } else
          await tx
            .insertInto('users')
            .values({
              id: userId,
              nickname: username,
              kind: 'member',
              handle: username,
              onboarded_at: new Date(),
            })
            .execute();
        await tx
          .insertInto('password_credentials')
          .values({ username, user_id: userId, password_hash: encoded })
          .execute();
        await initializeAnnouncements(tx, userId);
        return this.issue(tx, userId, 'member');
      };
      return transaction
        ? await execute(transaction)
        : await this.db.transaction().execute(execute);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY')
        throw new ConflictException('USERNAME_UNAVAILABLE');
      throw error;
    }
  }
  async login(
    input: { username: string; password: string; guestToken?: string },
    client: string,
  ): Promise<AuthResult> {
    const identifier = input.username.trim();
    const email = identifier.includes('@') ? z.email().parse(identifier) : null;
    const username = email ? null : Username.parse(identifier);
    const password = z.string().min(1).max(128).parse(input.password);
    const normalizedEmail = email
      ? email.slice(0, email.lastIndexOf('@') + 1) +
        email.slice(email.lastIndexOf('@') + 1).toLowerCase()
      : null;
    await this.consume('login-network:' + client, 100);
    await this.consume('login-account:' + (normalizedEmail || username));
    const identity = normalizedEmail
      ? await this.db
          .selectFrom('external_identities')
          .select('user_id')
          .where('provider', '=', 'email')
          .where('subject', '=', normalizedEmail)
          .executeTakeFirst()
      : null;
    const credential = await this.db
      .selectFrom('password_credentials')
      .selectAll()
      .where(
        normalizedEmail ? 'user_id' : 'username',
        '=',
        normalizedEmail ? identity?.user_id || '' : username!,
      )
      .executeTakeFirst();
    const valid = await verifyPassword(password, credential?.password_hash || '');
    if (!credential || !valid) throw new UnauthorizedException('INVALID_CREDENTIALS');
    return this.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', credential.user_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const current = await tx
        .selectFrom('password_credentials')
        .selectAll()
        .where('user_id', '=', credential.user_id)
        .forUpdate()
        .executeTakeFirst();
      if (
        !current ||
        current.password_hash !== credential.password_hash ||
        current.username !== credential.username
      )
        throw new UnauthorizedException('INVALID_CREDENTIALS');
      if (normalizedEmail) {
        const bound = await tx
          .selectFrom('external_identities')
          .select('user_id')
          .where('provider', '=', 'email')
          .where('subject', '=', normalizedEmail)
          .where('user_id', '=', credential.user_id)
          .forUpdate()
          .executeTakeFirst();
        if (!bound) throw new UnauthorizedException('INVALID_CREDENTIALS');
      }
      if (input.guestToken) await this.mergeGuest(tx, input.guestToken, credential.user_id);
      await new AuditService().append(tx, {
        actorId: credential.user_id,
        targetId: credential.user_id,
        kind: 'identity.password-login',
        reason: 'Password credential verified',
      });
      return this.issue(tx, credential.user_id, 'member');
    });
  }
  async guest(client: string): Promise<AuthResult> {
    await this.consume('guest:' + client, 100);
    return this.db.transaction().execute(async (tx) => {
      const id = randomUUID();
      await tx.insertInto('users').values({ id, nickname: '游客', kind: 'guest' }).execute();
      return this.issue(tx, id, 'guest');
    });
  }
  async authenticate(token: string, allowSuspended = false): Promise<Actor> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('AUTH_REQUIRED');
    const row = await this.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select(['users.id', 'users.kind', 'sessions.user_id', 'sessions.browser_anchor', 'sessions.browser_login_id', 'sessions.browser_version', 'sessions.last_seen_at'])
      .where('sessions.token_hash', '=', tokenHash(token))
      .where('sessions.expires_at', '>', new Date())
      .where('users.merged_into', 'is', null)
      .where('users.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw new UnauthorizedException('AUTH_REQUIRED');
    const [roles] = await Promise.all([
      this.db.selectFrom('platform_roles').select('role').where('user_id', '=', row.id).execute(),
      assertLiveBrowserSession(this.db, token, row),
      allowSuspended ? Promise.resolve() : import('../admin/restrictions.js').then(({ requireCapability }) => requireCapability(this.db, row.id, 'suspension')),
    ]);
    if (row.last_seen_at < new Date(Date.now() - 60000)) await this.db
      .updateTable('sessions')
      .set({ last_seen_at: new Date() })
      .where('token_hash', '=', tokenHash(token))
      .where('last_seen_at', '<', new Date(Date.now() - 60000))
      .execute();
    return { userId: row.id, kind: row.kind, platformRoles: roles.map((r) => r.role) };
  }
  async optionalActor(token: string | undefined, allowSuspended = false): Promise<Actor | null> {
    if (!token) return null;
    try {
      return await this.authenticate(token, allowSuspended);
    } catch (error) {
      if (error instanceof UnauthorizedException) return null;
      throw error;
    }
  }
  async logout(token: string): Promise<void> {
    await this.db.transaction().execute(tx=>revokeAccessSession(tx,token));
  }
  async reauthenticate(token: string, password: string, client: string) {
    const actor = await this.authenticate(token, true);
    await this.consume('reauth:' + client, 20);
    await this.consume('reauth-account:' + actor.userId);
    const credential = await this.db
      .selectFrom('password_credentials')
      .select('password_hash')
      .where('user_id', '=', actor.userId)
      .executeTakeFirst();
    if (!(await verifyPassword(password, credential?.password_hash || '')) || !credential)
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    await this.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', actor.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const current = await tx
        .selectFrom('password_credentials')
        .select('password_hash')
        .where('user_id', '=', actor.userId)
        .executeTakeFirst();
      if (current?.password_hash !== credential.password_hash)
        throw new UnauthorizedException('INVALID_CREDENTIALS');
      const result = await tx
        .updateTable('sessions')
        .set({ authenticated_at: new Date() })
        .where('token_hash', '=', tokenHash(token))
        .where('user_id', '=', actor.userId)
        .where('expires_at', '>', new Date())
        .executeTakeFirst();
      if (result.numUpdatedRows !== 1n) throw new UnauthorizedException('AUTH_REQUIRED');
      await new AuditService().append(tx, {
        actorId: actor.userId,
        targetId: actor.userId,
        kind: 'identity.reauthenticated',
        reason: 'Current password verified',
      });
    });
    return { ok: true };
  }
}
