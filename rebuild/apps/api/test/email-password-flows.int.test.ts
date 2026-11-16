import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { OtpService } from '../src/modules/identity/otp.service.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { AccountService } from '../src/modules/identity/account.service.js';
import type { OtpMessage } from '../src/modules/identity/otp-sender.js';

let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
const password = 'Verified Password 19!';
async function fixture() {
  h = await createTestApp();
  const messages: OtpMessage[] = [];
  let now = new Date();
  const otp = new OtpService(
    h.db,
    { hashKey: 'a'.repeat(64), dailyLimits: { email: 200, sms: 0 } },
    {
      email: {
        send: async (message) => {
          messages.push(message);
        },
      },
    },
    () => now,
  );
  const code = async (
    email: string,
    purpose: 'register' | 'password' | 'recovery' | 'login',
    token?: string,
  ) => {
    now = new Date(now.getTime() + 61000);
    const challenge = await otp.request('email', email, purpose, token);
    return { challengeId: challenge.challengeId, code: messages.at(-1)!.code };
  };
  const register = async (username: string, email: string) =>
    otp.register({ ...(await code(email, 'register')), username, password });
  return { otp, code, register, auth: new PasswordAuthService(h.db), messages };
}
describe('email registration and password proofs', () => {
  it('registers a chosen unique username and email, leaves one rename, rejects existing emails and usernames atomically', async () => {
    const { otp, code, register, auth } = await fixture();
    const member = await register('Chosen_Name', 'one@example.com');
    const overview = await new AccountService(h!.db).overview(member.token);
    expect(overview.handle).toBe('chosen_name');
    expect(overview.usernameChangesRemaining).toBe(1);
    for (const username of ['chosen_name', 'one@example.com'])
      expect((await auth.login({ username, password }, username)).actor.userId).toBe(
        member.actor.userId,
      );
    const duplicate = await code('two@example.com', 'register');
    await expect(otp.register({ ...duplicate, username: 'CHOSEN_NAME', password })).rejects.toThrow(
      'USERNAME_UNAVAILABLE',
    );
    const second = await otp.register({ ...duplicate, username: 'second_name', password });
    expect(second.actor.userId).not.toBe(member.actor.userId);
    await expect(
      otp.register({
        ...(await code('one@example.com', 'register')),
        username: 'another_name',
        password,
      }),
    ).rejects.toThrow('EMAIL_ALREADY_REGISTERED');
    expect(
      await h!.db.selectFrom('users').select('id').where('handle', '=', 'another_name').execute(),
    ).toHaveLength(0);
  });
  it('never creates an account with a login code and isolates registration, password and recovery codes', async () => {
    const { otp, code, register } = await fixture();
    await expect(otp.verifyLogin(await code('absent@example.com', 'login'))).rejects.toThrow(
      'ACCOUNT_NOT_REGISTERED',
    );
    expect(await h!.db.selectFrom('users').select('id').execute()).toHaveLength(0);
    const member = await register('existing_name', 'one@example.com');
    const login = await code('one@example.com', 'login');
    await expect(
      otp.changePassword(
        { ...login, currentPassword: password, password: 'Changed Password 28!' },
        member.token,
      ),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    expect((await otp.verifyLogin(login)).actor.userId).toBe(member.actor.userId);
    await expect(otp.verifyLogin(login)).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
  });
  it('requires both current password and bound email code, rejects cross-account codes and revokes sessions', async () => {
    const { otp, code, register, auth } = await fixture();
    const member = await register('password_owner', 'owner@example.com');
    const other = await register('password_other', 'other@example.com');
    const input = {
      ...(await code('owner@example.com', 'password', member.token)),
      password: 'Changed Password 28!',
    };
    await expect(
      otp.request('email', 'other@example.com', 'password', member.token),
    ).rejects.toThrow('BOUND_IDENTITY_REQUIRED');
    await expect(otp.changePassword(input, member.token)).rejects.toThrow(
      'CURRENT_PASSWORD_REQUIRED',
    );
    await expect(
      otp.changePassword({ ...input, currentPassword: 'wrong' }, member.token),
    ).rejects.toThrow('CURRENT_PASSWORD_INVALID');
    await expect(
      otp.changePassword({ ...input, currentPassword: password }, other.token),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    expect(
      (await auth.login({ username: 'password_owner', password }, 'still-valid')).actor.userId,
    ).toBe(member.actor.userId);
    const attempts = await Promise.allSettled([
      otp.changePassword({ ...input, currentPassword: password }, member.token),
      otp.changePassword({ ...input, currentPassword: password }, member.token),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    await expect(auth.authenticate(member.token)).rejects.toThrow('AUTH_REQUIRED');
    expect(
      (await auth.login({ username: 'owner@example.com', password: input.password }, 'changed'))
        .actor.userId,
    ).toBe(member.actor.userId);
    await expect(auth.login({ username: 'password_owner', password }, 'old')).rejects.toThrow(
      'INVALID_CREDENTIALS',
    );
  });
  it('checks a password code before editing, keeps it single-use and enforces owner and attempt limits', async () => {
    const { otp, code, register, auth } = await fixture();
    const member = await register('check_owner', 'check@example.com');
    const other = await register('check_other', 'other@example.com');
    const proof = await code('check@example.com', 'password', member.token);
    await expect(otp.checkPasswordChallenge(proof, other.token)).rejects.toThrow(
      'OTP_INVALID_OR_EXPIRED',
    );
    const wrong = { ...proof, code: proof.code === '000000' ? '111111' : '000000' };
    for (let attempt = 0; attempt < 4; attempt++)
      await expect(otp.checkPasswordChallenge(wrong, member.token)).rejects.toThrow(
        'OTP_INVALID_OR_EXPIRED',
      );
    expect(await otp.checkPasswordChallenge(proof, member.token)).toEqual({ ok: true });
    await expect(
      otp.changePassword({ ...proof, password: 'Changed Password 28!' }, member.token),
    ).rejects.toThrow('CURRENT_PASSWORD_REQUIRED');
    await expect(
      otp.changePassword(
        { ...proof, password: 'Changed Password 28!', currentPassword: 'incorrect' },
        member.token,
      ),
    ).rejects.toThrow('CURRENT_PASSWORD_INVALID');
    const changed = await otp.changePassword(
      { ...proof, password: 'Changed Password 28!', currentPassword: password },
      member.token,
    );
    await expect(otp.checkPasswordChallenge(proof, changed.token)).rejects.toThrow(
      'OTP_INVALID_OR_EXPIRED',
    );
    expect(
      (await auth.login({ username: 'check_owner', password: 'Changed Password 28!' }, 'check'))
        .actor.userId,
    ).toBe(member.actor.userId);
    const locked = await code('check@example.com', 'password', changed.token);
    const bad = { ...locked, code: locked.code === '000000' ? '111111' : '000000' };
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(otp.checkPasswordChallenge(bad, changed.token)).rejects.toThrow(
        'OTP_INVALID_OR_EXPIRED',
      );
    await expect(otp.checkPasswordChallenge(locked, changed.token)).rejects.toThrow(
      'OTP_INVALID_OR_EXPIRED',
    );
  });
  it('resets directly with an email code, consumes it once and invalidates prior sessions', async () => {
    const { otp, code, register, auth } = await fixture();
    const member = await register('recovery_owner', 'owner@example.com');
    const reset = {
      ...(await code('owner@example.com', 'recovery')),
      password: 'Recovered Password 39!',
    };
    const result = await otp.resetPassword(reset);
    expect(result.actor.userId).toBe(member.actor.userId);
    await expect(auth.authenticate(member.token)).rejects.toThrow('AUTH_REQUIRED');
    await expect(otp.resetPassword(reset)).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    expect(
      (await auth.login({ username: 'recovery_owner', password: reset.password }, 'new')).actor
        .userId,
    ).toBe(member.actor.userId);
    await request(h!.app.getHttpServer())
      .post('/api/v1/auth/password')
      .set('Authorization', 'Bearer ' + result.token)
      .send({ password: 'Bypass Password 19!' })
      .expect(400);
  });
});
