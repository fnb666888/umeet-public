import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type { OtpChannel, OtpPolicy, OtpSenders } from './otp-sender.js';
import {
  PasswordAuthService,
  type AuthResult,
  type VerifiedProofResolution,
} from './password-auth.service.js';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { UsernameSchema } from '../../../../../packages/contracts/src/index.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { consumeRegistrationInvite, requireCampusEmail } from '../settings/registration-policy.js';
export type OtpChallengeDto = {
  challengeId: string;
  expiresAt: string;
  resendAfterSeconds: number;
};
export class OtpService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly policy: OtpPolicy | null,
    private readonly senders: OtpSenders,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  private hash(id: string, code: string): string {
    if (!this.policy) throw new ServiceUnavailableException('LOGIN_CHANNEL_UNAVAILABLE');
    return createHmac('sha256', Buffer.from(this.policy.hashKey, 'hex'))
      .update(id + ':' + code)
      .digest('hex');
  }
  private recipient(channel: OtpChannel, value: string): string {
    if (channel === 'sms') {
      const result = z
        .string()
        .regex(/^\+[1-9]\d{7,14}$/)
        .safeParse(value);
      if (!result.success) throw new BadRequestException('INVALID_PHONE');
      return result.data;
    }
    const result = z.email().max(254).safeParse(value.trim());
    if (!result.success) throw new BadRequestException('INVALID_EMAIL');
    const at = result.data.lastIndexOf('@');
    return result.data.slice(0, at + 1) + result.data.slice(at + 1).toLowerCase();
  }
  async request(
    channel: OtpChannel,
    rawRecipient: string,
    purpose: 'login' | 'link' | 'reauth' | 'recovery' | 'register' | 'password' = 'login',
    sessionToken?: string,
  ): Promise<OtpChallengeDto> {
    if (['register', 'password', 'recovery'].includes(purpose) && channel !== 'email')
      throw new BadRequestException('INVALID_INPUT');
    const sender = this.senders[channel];
    if (!this.policy || !sender) throw new ServiceUnavailableException('LOGIN_CHANNEL_UNAVAILABLE');
    const recipient = this.recipient(channel, rawRecipient),
      now = this.clock(),
      expiresAt = new Date(now.getTime() + 600000);
    if (purpose === 'register')
      requireCampusEmail((await new SettingsService(this.db).getSiteSettings()).settings.registration, recipient);
    const owner =
      purpose === 'link' || purpose === 'reauth' || purpose === 'password'
        ? (await new PasswordAuthService(this.db).authenticate(sessionToken || '', purpose === 'reauth')).userId
        : null;
    if (purpose === 'link')
      await new PasswordAuthService(this.db).requireRecentMember(
        sessionToken || '',
        undefined,
        now,
      );
    if (purpose === 'reauth' || purpose === 'password') {
      const identity = await this.db
        .selectFrom('external_identities')
        .select('user_id')
        .where('provider', '=', channel === 'email' ? 'email' : 'sms')
        .where('subject', '=', recipient)
        .where('user_id', '=', owner!)
        .executeTakeFirst();
      if (!identity) throw new BadRequestException('BOUND_IDENTITY_REQUIRED');
    }
    const id = randomUUID(),
      code = String(randomInt(0, 1000000)).padStart(6, '0');
    const recipientKey = createHash('sha256')
      .update(JSON.stringify([channel, recipient]))
      .digest('hex');
    const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    const recoverable =
      purpose === 'recovery'
        ? await this.db
            .selectFrom('external_identities')
            .innerJoin('users', 'users.id', 'external_identities.user_id')
            .select('users.id')
            .where('provider', '=', 'email')
            .where('subject', '=', recipient)
            .where('users.deleted_at', 'is', null)
            .where('users.kind', '=', 'member')
            .executeTakeFirst()
        : null;
    if (purpose === 'recovery' && channel !== 'email')
      throw new BadRequestException('INVALID_INPUT');
    const challengeOwner = purpose === 'recovery' ? recoverable?.id || null : owner;
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('otp_recipients')
        .values({
          key_hash: recipientKey,
          next_send_at: new Date(0),
          window_start: now,
          send_count: 0,
        })
        .onDuplicateKeyUpdate({ key_hash: recipientKey })
        .execute();
      const rate = await tx
        .selectFrom('otp_recipients')
        .selectAll()
        .where('key_hash', '=', recipientKey)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (rate.next_send_at > now)
        throw new HttpException(
          {
            message: 'OTP_RESEND_TOO_SOON',
            retryAfterSeconds: Math.ceil((rate.next_send_at.getTime() - now.getTime()) / 1000),
          },
          429,
        );
      const reset = now.getTime() - rate.window_start.getTime() >= 3600000;
      if (!reset && rate.send_count >= 6)
        throw new HttpException('OTP_RECIPIENT_LIMIT_REACHED', 429);
      await tx
        .insertInto('otp_delivery_budgets')
        .values({ channel, business_day: day, send_count: 0 })
        .onDuplicateKeyUpdate({ channel })
        .execute();
      const budget = await tx
        .selectFrom('otp_delivery_budgets')
        .select('send_count')
        .where('channel', '=', channel)
        .where('business_day', '=', day)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (budget.send_count >= this.policy!.dailyLimits[channel])
        throw new HttpException('OTP_DAILY_LIMIT_REACHED', 429);
      await tx
        .updateTable('otp_delivery_budgets')
        .set({ send_count: budget.send_count + 1 })
        .where('channel', '=', channel)
        .where('business_day', '=', day)
        .execute();
      await tx
        .updateTable('otp_recipients')
        .set({
          next_send_at: new Date(now.getTime() + 60000),
          window_start: reset ? now : rate.window_start,
          send_count: reset ? 1 : rate.send_count + 1,
        })
        .where('key_hash', '=', recipientKey)
        .execute();
      await tx
        .updateTable('otp_challenges')
        .set({ state: 'replaced' })
        .where('channel', '=', channel)
        .where('recipient', '=', recipient)
        .where('purpose', '=', purpose)
        .where('owner_id', challengeOwner ? '=' : 'is', challengeOwner)
        .where('state', 'in', ['active', 'sending'])
        .execute();
      await tx
        .insertInto('otp_challenges')
        .values({
          id,
          channel,
          recipient,
          purpose,
          owner_id: challengeOwner,
          code_hash: this.hash(id, code),
          expires_at: expiresAt,
          state: purpose === 'recovery' && !recoverable ? 'failed' : 'sending',
        })
        .execute();
    });
    if (purpose === 'recovery' && !recoverable)
      return { challengeId: id, expiresAt: expiresAt.toISOString(), resendAfterSeconds: 60 };
    try {
      await sender.send({ recipient, code, challengeId: id, expiresInMinutes: 10 });
    } catch {
      await this.db
        .updateTable('otp_challenges')
        .set({ state: 'failed' })
        .where('id', '=', id)
        .where('state', '=', 'sending')
        .execute();
      throw new ServiceUnavailableException('OTP_SEND_UNAVAILABLE');
    }
    await this.db
      .updateTable('otp_challenges')
      .set({ state: 'active' })
      .where('id', '=', id)
      .where('state', '=', 'sending')
      .execute();
    return { challengeId: id, expiresAt: expiresAt.toISOString(), resendAfterSeconds: 60 };
  }
  private async resolve(
    tx: Transaction<Database>,
    input: { challengeId: string; code: string },
    purpose: 'login' | 'link' | 'reauth' | 'recovery' | 'register' | 'password',
    ownerId: string | null,
    consume = true,
  ): Promise<VerifiedProofResolution> {
    if (!this.policy) throw new ServiceUnavailableException('LOGIN_CHANNEL_UNAVAILABLE');
    const invalid = () => ({ error: new UnauthorizedException('OTP_INVALID_OR_EXPIRED') });
    const parsed = z
      .strictObject({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
      .safeParse(input);
    if (!parsed.success) throw new BadRequestException('INVALID_INPUT');
    const row = await tx
      .selectFrom('otp_challenges')
      .selectAll()
      .where('id', '=', input.challengeId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !row ||
      row.state !== 'active' ||
      row.purpose !== purpose ||
      row.owner_id !== ownerId ||
      row.expires_at <= this.clock() ||
      row.attempts >= 5
    )
      return invalid();
    const actual = Buffer.from(this.hash(row.id, input.code), 'hex'),
      expected = Buffer.from(row.code_hash, 'hex');
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (consume || !matches)
      await tx
        .updateTable('otp_challenges')
        .set({ attempts: row.attempts + 1 })
        .where('id', '=', row.id)
        .execute();
    if (!matches) return invalid();
    if (consume)
      await tx
        .updateTable('otp_challenges')
        .set({ state: 'consumed' })
        .where('id', '=', row.id)
        .execute();
    return {
      proof: {
        identities: [
          { provider: row.channel === 'email' ? 'email' : 'sms', subject: row.recipient },
        ],
        nickname: '新朋友',
      },
    };
  }
  async verifyLogin(
    input: { challengeId: string; code: string },
    guestToken?: string,
    device?: string,
  ): Promise<AuthResult> {
    return new PasswordAuthService(this.db, device).withVerifiedProof(async (tx) => {
      const resolution = await this.resolve(tx, input, 'login', null);
      if ('error' in resolution) return resolution;
      const identity = resolution.proof.identities[0]!;
      const existing = await tx
        .selectFrom('external_identities')
        .innerJoin('users', 'users.id', 'external_identities.user_id')
        .select('users.id')
        .where('provider', '=', identity.provider)
        .where('subject', '=', identity.subject)
        .where('users.deleted_at', 'is', null)
        .where('users.merged_into', 'is', null)
        .where('users.kind', '=', 'member')
        .forUpdate()
        .executeTakeFirst();
      if (!existing) return { error: new UnauthorizedException('ACCOUNT_NOT_REGISTERED') };
      return resolution;
    }, guestToken);
  }
  async register(
    input: { challengeId: string; code: string; username: string; password: string; inviteCode?: string | undefined },
    guestToken?: string,
    device?: string,
  ) {
    const username = UsernameSchema.parse(input.username);
    z.string().min(12).max(128).parse(input.password);
    const auth = new PasswordAuthService(this.db, device);
    try {
      const outcome = await auth.transact(async (tx) => {
        const resolution = await this.resolve(
          tx,
          { challengeId: input.challengeId, code: input.code },
          'register',
          null,
        );
        if ('error' in resolution) return resolution;
        const email = resolution.proof.identities[0]!;
        const existing = await tx
          .selectFrom('external_identities')
          .select('user_id')
          .where('provider', '=', 'email')
          .where('subject', '=', email.subject)
          .forUpdate()
          .executeTakeFirst();
        if (existing) throw new ConflictException('EMAIL_ALREADY_REGISTERED');
        const reserved = await tx
          .selectFrom('users')
          .select('id')
          .where('handle', '=', username)
          .executeTakeFirst();
        if (reserved) throw new ConflictException('USERNAME_UNAVAILABLE');
        const { settings } = await new SettingsService(tx).getSiteSettings();
        requireCampusEmail(settings.registration, email.subject);
        if (settings.registration.mode === 'invite') await consumeRegistrationInvite(tx, input.inviteCode);
        const result = await auth.register(
          { username, password: input.password, ...(guestToken ? { guestToken } : {}) },
          'email-registration',
          tx,
        );
        await tx
          .insertInto('external_identities')
          .values({ provider: 'email', subject: email.subject, user_id: result.actor.userId })
          .execute();
        return { result };
      });
      if ('error' in outcome) throw outcome.error;
      return outcome.result;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY')
        throw new ConflictException('EMAIL_ALREADY_REGISTERED');
      throw error;
    }
  }
  async checkPasswordChallenge(input: { challengeId: string; code: string }, token: string) {
    const actor = await new PasswordAuthService(this.db).authenticate(token);
    if (actor.kind !== 'member') throw new UnauthorizedException('REGISTERED_ACCOUNT_REQUIRED');
    const result = await this.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', actor.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const user = await tx
        .selectFrom('users')
        .select(['deleted_at', 'merged_into'])
        .where('id', '=', actor.userId)
        .executeTakeFirstOrThrow();
      if (user.deleted_at || user.merged_into) throw new UnauthorizedException('AUTH_REQUIRED');
      const session = await tx
        .selectFrom('sessions')
        .select('user_id')
        .where('token_hash', '=', createHash('sha256').update(token).digest('hex'))
        .where('expires_at', '>', this.clock())
        .forUpdate()
        .executeTakeFirst();
      if (!session) throw new UnauthorizedException('AUTH_REQUIRED');
      const resolution = await this.resolve(tx, input, 'password', actor.userId, false);
      if ('error' in resolution) return resolution;
      const bound = await tx
        .selectFrom('external_identities')
        .select('user_id')
        .where('provider', '=', 'email')
        .where('subject', '=', resolution.proof.identities[0]!.subject)
        .where('user_id', '=', actor.userId)
        .executeTakeFirst();
      if (!bound) throw new UnauthorizedException('BOUND_IDENTITY_REQUIRED');
      return { ok: true };
    });
    if ('error' in result) throw result.error;
    return result;
  }
  async changePassword(
    input: {
      challengeId: string;
      code: string;
      password: string;
      currentPassword?: string | undefined;
    },
    token: string,
    device?: string,
  ) {
    const auth = new PasswordAuthService(this.db, device);
    const actor = await auth.authenticate(token);
    if (actor.kind !== 'member') throw new UnauthorizedException('REGISTERED_ACCOUNT_REQUIRED');
    const outcome = await auth.transact(async (tx) => {
      // Lock the account before its challenge, matching other authenticated email actions.
      const user = await tx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', actor.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (user.deleted_at || user.merged_into) throw new UnauthorizedException('AUTH_REQUIRED');
      const session = await tx
        .selectFrom('sessions')
        .select('user_id')
        .where('token_hash', '=', createHash('sha256').update(token).digest('hex'))
        .where('expires_at', '>', this.clock())
        .forUpdate()
        .executeTakeFirst();
      if (!session) throw new UnauthorizedException('AUTH_REQUIRED');
      const existing = await tx
        .selectFrom('password_credentials')
        .select('user_id')
        .where('user_id', '=', actor.userId)
        .executeTakeFirst();
      if (existing && !input.currentPassword)
        throw new BadRequestException('CURRENT_PASSWORD_REQUIRED');
      const resolution = await this.resolve(
        tx,
        { challengeId: input.challengeId, code: input.code },
        'password',
        actor.userId,
      );
      if ('error' in resolution) return resolution;
      const email = resolution.proof.identities[0]!;
      const bound = await tx
        .selectFrom('external_identities')
        .select('user_id')
        .where('provider', '=', 'email')
        .where('subject', '=', email.subject)
        .where('user_id', '=', actor.userId)
        .forUpdate()
        .executeTakeFirst();
      if (!bound) throw new UnauthorizedException('BOUND_IDENTITY_REQUIRED');
      return {
        result: await auth.setVerifiedPassword(
          tx,
          actor.userId,
          input.password,
          input.currentPassword,
        ),
      };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.result;
  }
  async resetPassword(
    input: { challengeId: string; code: string; password: string },
    device?: string,
  ) {
    const auth = new PasswordAuthService(this.db, device);
    const outcome = await auth.transact(async (tx) => {
      const challenge = await tx
        .selectFrom('otp_challenges')
        .select('owner_id')
        .where('id', '=', input.challengeId)
        .executeTakeFirst();
      if (challenge?.owner_id)
        await tx
          .selectFrom('users')
          .select('id')
          .where('id', '=', challenge.owner_id)
          .forUpdate()
          .executeTakeFirst();
      const resolution = await this.resolve(
        tx,
        { challengeId: input.challengeId, code: input.code },
        'recovery',
        challenge?.owner_id || null,
      );
      if ('error' in resolution) return resolution;
      const email = resolution.proof.identities[0]!;
      const bound = await tx
        .selectFrom('external_identities')
        .innerJoin('users', 'users.id', 'external_identities.user_id')
        .select('users.id')
        .where('provider', '=', 'email')
        .where('subject', '=', email.subject)
        .where('users.id', '=', challenge?.owner_id || '')
        .where('users.deleted_at', 'is', null)
        .where('users.merged_into', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!bound) return { error: new UnauthorizedException('OTP_INVALID_OR_EXPIRED') };
      return { result: await auth.setVerifiedPassword(tx, bound.id, input.password) };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.result;
  }
  async verifyLink(
    input: { challengeId: string; code: string },
    memberToken: string,
  ): Promise<{ linked: true }> {
    return new PasswordAuthService(this.db).withVerifiedLink(
      (tx, actor) => this.resolve(tx, input, 'link', actor.userId),
      memberToken,
      this.clock(),
    );
  }
  async verifyReauthentication(input: { challengeId: string; code: string }, token: string) {
    const auth = new PasswordAuthService(this.db);
    const actor = await auth.authenticate(token, true);
    const result = await this.db.transaction().execute(async (tx) => {
      const user = await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', actor.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const resolution = await this.resolve(tx, input, 'reauth', user.id);
      if ('error' in resolution) return resolution;
      const identity = resolution.proof.identities[0]!;
      const bound = await tx
        .selectFrom('external_identities')
        .select('user_id')
        .where('provider', '=', identity.provider)
        .where('subject', '=', identity.subject)
        .where('user_id', '=', user.id)
        .forUpdate()
        .executeTakeFirst();
      if (!bound) throw new UnauthorizedException('BOUND_IDENTITY_REQUIRED');
      const session = await tx
        .updateTable('sessions')
        .set({ authenticated_at: this.clock() })
        .where('token_hash', '=', createHash('sha256').update(token).digest('hex'))
        .where('user_id', '=', user.id)
        .where('expires_at', '>', this.clock())
        .executeTakeFirst();
      if (session.numUpdatedRows !== 1n) throw new UnauthorizedException('AUTH_REQUIRED');
      await new AuditService().append(tx, {
        actorId: user.id,
        targetId: user.id,
        kind: 'identity.reauthenticated',
        reason: 'Bound identity verified',
      });
      return { ok: true };
    });
    if ('error' in result) throw result.error;
    return result;
  }
}
