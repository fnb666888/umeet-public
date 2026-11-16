// Synthetic format-valid AppID for isolated tests; never a real application.
const TEST_WECHAT_APP_ID = 'wx' + '0'.repeat(16);
import { afterEach, describe, expect, it, vi } from 'vitest';
import { up as accountMigration } from '../src/database/migrations/015_account_center.js';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { AccountService } from '../src/modules/identity/account.service.js';
import { OtpService } from '../src/modules/identity/otp.service.js';
import { DemoSnapshotsService } from '../src/modules/demo/demo-snapshots.service.js';
import type { OtpMessage } from '../src/modules/identity/otp-sender.js';

let h: TestApp | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await h?.close();
  h = undefined;
});
const proof = (subject: string) => ({
  identities: [{ provider: 'email', subject }],
  nickname: '新朋友',
});
describe('account center ownership and lifecycle', () => {
  it('keeps concurrent community and account profile updates consistent', async () => {
    h = await createTestApp();
    const member = await new PasswordAuthService(h.db).acceptExternalProof(
      proof('profile@example.com'),
    );
    const account = new AccountService(h.db);
    const community = new DemoSnapshotsService(h.db);
    const profile = {
      name: '原昵称',
      bio: '保留简介',
      avatar: '',
      school: '',
      campus: '',
      dept: '',
      year: '',
      tags: [],
    };
    await community.save(member.actor.userId, {
      id: 'initial-profile',
      operations: [{ type: 'profile.save', profile }],
    });
    await Promise.all([
      account.profile(member.token, { handle: 'profile_member', nickname: '账号中心昵称' }),
      community.save(member.actor.userId, {
        id: 'concurrent-profile',
        operations: [{ type: 'profile.save', profile: { ...profile, name: '主页昵称' } }],
      }),
    ]);
    const overview = await account.overview(member.token);
    const snapshot = await community.get(member.actor.userId);
    expect(snapshot.userState.profile?.name).toBe(overview.nickname);
    expect(snapshot.userState.profile?.bio).toBe('保留简介');
  });
  it('keeps a usable web login when an email account also has WeChat', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.acceptExternalProof(proof('web-login@example.com'));
    await auth.withVerifiedLink(
      async () => ({
        proof: {
          identities: [{ provider: 'wechat-mini', subject: 'wx-login-owner' }],
          nickname: '微信用户',
        },
      }),
      member.token,
    );
    const account = new AccountService(h.db);
    const email = (await account.overview(member.token)).identities.find(
      (identity) => identity.provider === 'email',
    )!;
    await expect(account.unlink(member.token, email.key)).rejects.toThrow('LAST_WEB_LOGIN_METHOD');
  });
  it('can retry the additive migration and reauthenticate existing password accounts', async () => {
    h = await createTestApp();
    await accountMigration(h.db);
    const auth = new PasswordAuthService(h.db);
    const member = await auth.register(
      { username: 'legacy_member', password: 'Strong Password 82!' },
      'legacy',
    );
    await h.db
      .updateTable('sessions')
      .set({ authenticated_at: new Date(0) })
      .execute();
    await expect(auth.reauthenticate(member.token, 'wrong password', 'wrong')).rejects.toThrow(
      'INVALID_CREDENTIALS',
    );
    await auth.reauthenticate(member.token, 'Strong Password 82!', 'right');
    expect((await new AccountService(h.db).overview(member.token)).requiresReauthentication).toBe(
      false,
    );
    await auth.logout(member.token);
    await expect(
      auth.reauthenticate(member.token, 'Strong Password 82!', 'revoked'),
    ).rejects.toThrow('AUTH_REQUIRED');
  });
  it('binds verified native WeChat to an existing email account and refuses cross-account conflicts', async () => {
    h = await createTestApp({
      wechatMini: { appId: TEST_WECHAT_APP_ID, appSecret: 'test-secret' },
    });
    const auth = new PasswordAuthService(h.db);
    const member = await auth.acceptExternalProof(proof('web@example.com'));
    const other = await auth.acceptExternalProof(proof('otherweb@example.com'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ openid: 'wx-owner' })),
    );
    const server = h.app.getHttpServer();
    await request(server)
      .post('/api/v1/auth/wechat/link')
      .set('Authorization', 'Bearer ' + member.token)
      .send({ code: 'verified-code' })
      .expect(201);
    const login = await request(server)
      .post('/api/v1/auth/wechat/mini')
      .send({ code: 'another-code' })
      .expect(201);
    expect(login.body.actor.userId).toBe(member.actor.userId);
    await request(server)
      .post('/api/v1/auth/wechat/link')
      .set('Authorization', 'Bearer ' + other.token)
      .send({ code: 'conflict-code' })
      .expect(409);
    expect((await new AccountService(h.db).overview(other.token)).identities).toHaveLength(1);
  });
  it('generates unique usernames and permits one globally unique change', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db, 'Test browser');
    const member = await auth.acceptExternalProof(proof('first@example.com'));
    const account = new AccountService(h.db);
    const initial = await account.overview(member.token);
    expect(initial.needsOnboarding).toBe(false);
    expect(initial.handle).toMatch(/^user_[a-f0-9]{12}$/);
    expect(initial.nickname).toBe(initial.handle);
    expect(initial.usernameChangesRemaining).toBe(1);
    const done = await account.profile(member.token, { handle: 'my_handle', nickname: '同学甲' });
    expect(done.needsOnboarding).toBe(false);
    expect(done.handle).toBe('my_handle');
    expect(done.nickname).toBe('my_handle');
    expect(done.usernameChangesRemaining).toBe(0);
    expect(done.sessions[0]?.device).toBe('Test browser');
    expect(JSON.stringify(done)).not.toContain(member.token);
    expect(JSON.stringify(done)).not.toContain('token_hash');
    const other = await auth.acceptExternalProof(proof('other@example.com'));
    await expect(
      account.profile(other.token, { handle: 'my_handle', nickname: '另一个人' }),
    ).rejects.toThrow('HANDLE_UNAVAILABLE');
    expect((await account.overview(other.token)).usernameChangesRemaining).toBe(1);
    await expect(
      account.profile(member.token, { handle: 'new_handle', nickname: '改名' }),
    ).rejects.toThrow('USERNAME_CHANGE_LIMIT');
    expect(
      (await account.profile(member.token, { handle: 'my_handle', nickname: '新昵称' })).nickname,
    ).toBe('my_handle');
  });
  it('protects the last credential and serializes concurrent removals', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.acceptExternalProof(proof('one@example.com'));
    const account = new AccountService(h.db);
    const first = await account.overview(member.token);
    await expect(account.unlink(member.token, first.identities[0]!.key)).rejects.toThrow(
      'LAST_LOGIN_METHOD',
    );
    await auth.withVerifiedLink(async () => ({ proof: proof('two@example.com') }), member.token);
    const linked = await account.overview(member.token);
    const attempts = await Promise.allSettled(
      linked.identities.map((identity) => account.unlink(member.token, identity.key)),
    );
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await account.overview(member.token)).identities).toHaveLength(1);
  });
  it('revokes only owned devices, enforces recent verification and preserves current device', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.acceptExternalProof(proof('owner@example.com'));
    const another = await auth.acceptExternalProof(proof('owner@example.com'));
    const stranger = await auth.acceptExternalProof(proof('stranger@example.com'));
    const account = new AccountService(h.db);
    const target = (await account.overview(stranger.token)).sessions[0]!;
    await account.revoke(member.token, target.id);
    expect((await auth.authenticate(stranger.token)).userId).toBe(stranger.actor.userId);
    await account.revoke(member.token, 'others');
    await expect(auth.authenticate(another.token)).rejects.toThrow('AUTH_REQUIRED');
    expect((await auth.authenticate(member.token)).userId).toBe(member.actor.userId);
    await h.db
      .updateTable('sessions')
      .set({ authenticated_at: new Date(0) })
      .where('user_id', '=', member.actor.userId)
      .execute();
    await expect(account.revoke(member.token, 'others')).rejects.toThrow(
      'REAUTHENTICATION_REQUIRED',
    );
  });
  it('reauthenticates only the current account bound email and consumes each code once', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.acceptExternalProof(proof('reauth@example.com'));
    await h.db
      .updateTable('sessions')
      .set({ authenticated_at: new Date(0) })
      .execute();
    const messages: OtpMessage[] = [];
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
    );
    await expect(
      otp.request('email', 'unbound@example.com', 'reauth', member.token),
    ).rejects.toThrow('BOUND_IDENTITY_REQUIRED');
    const challenge = await otp.request('email', 'reauth@example.com', 'reauth', member.token);
    await expect(
      otp.verifyReauthentication(
        {
          challengeId: challenge.challengeId,
          code: messages[0]!.code === '000000' ? '111111' : '000000',
        },
        member.token,
      ),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    expect(
      await otp.verifyReauthentication(
        { challengeId: challenge.challengeId, code: messages[0]!.code },
        member.token,
      ),
    ).toEqual({ ok: true });
    expect((await new AccountService(h.db).overview(member.token)).requiresReauthentication).toBe(
      false,
    );
    await expect(
      otp.verifyReauthentication(
        { challengeId: challenge.challengeId, code: messages[0]!.code },
        member.token,
      ),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
  });
  it('requires email registration when email is enabled and exposes account endpoints only to owners', async () => {
    h = await createTestApp(
      {
        otp: {
          policy: { hashKey: 'a'.repeat(64), dailyLimits: { email: 10, sms: 0 } },
          email: {
            host: 'smtp.example.com',
            port: 587,
            security: 'starttls',
            user: 'u',
            password: 'p',
            from: 'from@example.com',
          },
        },
      },
      { email: { send: async () => {} } },
    );
    const server = h.app.getHttpServer();
    await request(server).get('/api/v1/account').expect(401);
    await request(server)
      .post('/api/v1/auth/register')
      .send({ username: 'bypass', password: 'Strong Password 39!' })
      .expect(400);
    const member = await new PasswordAuthService(h.db).acceptExternalProof(
      proof('http@example.com'),
    );
    const result = await request(server)
      .get('/api/v1/account')
      .set('Authorization', 'Bearer ' + member.token)
      .expect(200);
    expect(result.body.userId).toBe(member.actor.userId);
    await request(server)
      .post('/api/v1/account/profile')
      .set('Authorization', 'Bearer ' + member.token)
      .send({ handle: 'http_member', nickname: '用户', userId: 'other' })
      .expect(400);
  });
});
