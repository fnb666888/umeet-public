import { afterEach, describe, it, expect } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { OtpService } from '../src/modules/identity/otp.service.js';
import type { OtpMessage, OtpSenders } from '../src/modules/identity/otp-sender.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function fixture(limits = { email: 200, sms: 20 }) {
  h = await createTestApp();
  const messages: OtpMessage[] = [];
  let now = new Date();
  const senders: OtpSenders = {
    email: {
      send: async (message) => {
        messages.push(message);
      },
    },
    sms: {
      send: async (message) => {
        messages.push(message);
      },
    },
  };
  return {
    db: h.db,
    messages,
    senders,
    auth: new PasswordAuthService(h.db),
    records: new IdentityService(h.db),
    otp: new OtpService(h.db, { hashKey: 'a'.repeat(64), dailyLimits: limits }, senders, () => now),
    at:(value:string)=>{now=new Date(value);},
    advance: (seconds: number) => {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}
describe('persisted one-time codes without a production test bypass', () => {
  it('does not overspend a concurrent daily budget and resets it on the Shanghai business day',async()=>{
    const {otp,messages,at,advance}=await fixture({email:200,sms:1});at('2026-11-07T15:59:59.000Z');
    const results=await Promise.allSettled(['+8613800000000','+8613900000000'].map(phone=>otp.request('sms',phone)));
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(messages).toHaveLength(1);
    advance(2);await otp.request('sms','+8613700000000');expect(messages).toHaveLength(2);
  });
  it('never returns a code, upgrades a guest in place and consumes a code exactly once under concurrency', async () => {
    const { otp, auth, records, messages, db } = await fixture();
    const guest = await auth.guest('otp-guest');
    await records.savePersonalRecord(guest.actor, 'draft', 'guest-draft', '验证后仍在');
    const challenge = await otp.request('email', 'Student@EXAMPLE.COM', 'register');
    const code = messages[0]!.code;
    expect(Object.keys(challenge).sort()).toEqual(
      ['challengeId', 'expiresAt', 'resendAfterSeconds'].sort(),
    );
    expect(messages[0]!.recipient).toBe('Student@example.com');
    const results = await Promise.allSettled([
      otp.register({ challengeId: challenge.challengeId, code, username: 'registered_student', password: 'Verified Password 19!' }, guest.token),
      otp.register({ challengeId: challenge.challengeId, code, username: 'registered_student', password: 'Verified Password 19!' }, guest.token),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const succeeded = results.find((r) => r.status === 'fulfilled');
    if (succeeded?.status !== 'fulfilled') throw new Error('expected login');
    expect(succeeded.value.actor.userId).toBe(guest.actor.userId);
    expect(succeeded.value.actor.kind).toBe('member');
    expect(await records.readPersonalRecord(succeeded.value.actor, 'draft', 'guest-draft')).toBe(
      '验证后仍在',
    );
    await expect(auth.authenticate(guest.token)).rejects.toThrow('AUTH_REQUIRED');
    const row = await db
      .selectFrom('otp_challenges')
      .selectAll()
      .where('id', '=', challenge.challengeId)
      .executeTakeFirstOrThrow();
    expect(row.code_hash).not.toContain(code);
    expect(row.state).toBe('consumed');
  });
  it('persists wrong-attempt limits and refuses expired or replaced codes', async () => {
    const { otp, messages, advance, db } = await fixture();
    const challenge = await otp.request('sms', '+8613800000000');
    const code = messages[0]!.code,
      wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await expect(
        otp.verifyLogin({ challengeId: challenge.challengeId, code: wrong }),
      ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    expect(
      (
        await db
          .selectFrom('otp_challenges')
          .select('attempts')
          .where('id', '=', challenge.challengeId)
          .executeTakeFirstOrThrow()
      ).attempts,
    ).toBe(5);
    await expect(otp.verifyLogin({ challengeId: challenge.challengeId, code })).rejects.toThrow(
      'OTP_INVALID_OR_EXPIRED',
    );
    const expired = await otp.request('email', 'expired@example.com');
    advance(601);
    await expect(
      otp.verifyLogin({ challengeId: expired.challengeId, code: messages.at(-1)!.code }),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    const old = await otp.request('email', 'replace@example.com');
    const oldCode = messages.at(-1)!.code;
    advance(61);
    await otp.request('email', 'replace@example.com');
    await expect(otp.verifyLogin({ challengeId: old.challengeId, code: oldCode })).rejects.toThrow(
      'OTP_INVALID_OR_EXPIRED',
    );
  });
  it('enforces resend, recipient-hour and daily send budgets before calling a sender', async () => {
    const { otp, messages, advance } = await fixture({ email: 200, sms: 1 });
    await otp.request('sms', '+8613800000000');
    await expect(otp.request('sms', '+8613900000000')).rejects.toThrow('OTP_DAILY_LIMIT_REACHED');
    expect(messages).toHaveLength(1);
    await otp.request('email', 'limit@example.com');
    await expect(otp.request('email', 'limit@example.com')).rejects.toThrow('OTP_RESEND_TOO_SOON');
    for (let i = 0; i < 5; i++) {
      advance(61);
      await otp.request('email', 'limit@example.com');
    }
    advance(61);
    await expect(otp.request('email', 'limit@example.com')).rejects.toThrow(
      'OTP_RECIPIENT_LIMIT_REACHED',
    );
  });
  it('fails closed when no sender exists or sending fails, without issuing a usable challenge', async () => {
    const { db, otp, senders, messages } = await fixture();
    await expect(
      new OtpService(db, null, {}).request('email', 'disabled@example.com'),
    ).rejects.toThrow('LOGIN_CHANNEL_UNAVAILABLE');
    senders.email = {
      send: async () => {
        throw new Error('private-provider-secret');
      },
    };
    await expect(otp.request('email', 'failed@example.com')).rejects.toThrow(
      'OTP_SEND_UNAVAILABLE',
    );
    expect(messages).toEqual([]);
    expect(
      (await db.selectFrom('otp_challenges').selectAll().executeTakeFirstOrThrow()).state,
    ).toBe('failed');
  });
  it('binds a verified address only to its recent authenticated member and then logs into that same account', async () => {
    const { otp, auth, messages, db, advance } = await fixture();
    const member = await auth.register(
      { username: 'otp_binding', password: 'A Real Password 49!' },
      'binding-client',
    );
    const other = await auth.register(
      { username: 'other_binding', password: 'Another Password 89!' },
      'other-client',
    );
    const challenge = await otp.request('email', 'bound@example.com', 'link', member.token);
    const code = messages.at(-1)!.code;
    await expect(otp.verifyLogin({ challengeId: challenge.challengeId, code })).rejects.toThrow(
      'OTP_INVALID_OR_EXPIRED',
    );
    await expect(
      otp.verifyLink({ challengeId: challenge.challengeId, code }, other.token),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    expect(
      await otp.verifyLink({ challengeId: challenge.challengeId, code }, member.token),
    ).toEqual({ linked: true });
    advance(61);
    const signin = await otp.request('email', 'bound@example.com');
    const result = await otp.verifyLogin({
      challengeId: signin.challengeId,
      code: messages.at(-1)!.code,
    });
    expect(result.actor.userId).toBe(member.actor.userId);
    advance(61);
    const conflict = await otp.request('email', 'bound@example.com', 'link', other.token);
    await expect(
      otp.verifyLink(
        { challengeId: conflict.challengeId, code: messages.at(-1)!.code },
        other.token,
      ),
    ).rejects.toThrow('IDENTITY_ACCOUNT_CONFLICT');
    await db
      .updateTable('sessions')
      .set({ authenticated_at: new Date(0) })
      .execute();
    await expect(otp.request('sms', '+8613800000000', 'link', member.token)).rejects.toThrow(
      'REAUTHENTICATION_REQUIRED',
    );
  });
});
