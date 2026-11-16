import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { AccountService } from '../src/modules/identity/account.service.js';
import { DemoSnapshotsService } from '../src/modules/demo/demo-snapshots.service.js';
import { up } from '../src/database/migrations/017_unified_username.js';

let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
const proof = (subject: string) => ({
  identities: [{ provider: 'email', subject }],
  nickname: '旧昵称',
});
describe('unified username', () => {
  it('allocates unique usernames to email accounts and guest upgrades and keeps them on login', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const guest = await auth.guest('upgrade');
    const one = await auth.acceptExternalProof(proof('one@example.com'), guest.token);
    const two = await auth.acceptExternalProof(proof('two@example.com'));
    const again = await auth.acceptExternalProof(proof('one@example.com'));
    const account = new AccountService(h.db);
    const first = await account.overview(one.token);
    expect(first.handle).toMatch(/^user_[a-f0-9]{12}$/);
    expect(first.handle).not.toBe((await account.overview(two.token)).handle);
    expect(first.handle).toBe((await account.overview(again.token)).handle);
    expect(one.actor.userId).toBe(guest.actor.userId);
    await account.profile(one.token, { handle: first.handle });
    expect((await account.overview(one.token)).usernameChangesRemaining).toBe(1);
  });
  it('serializes rename attempts, synchronizes password login and prevents profile name bypasses', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.register(
      { username: 'before_change', password: 'Verified Password 19!' },
      'rename',
    );
    const account = new AccountService(h.db);
    const attempts = await Promise.allSettled([
      account.profile(member.token, { handle: 'after_one' }),
      account.profile(member.token, { handle: 'after_two' }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const result = await account.overview(member.token);
    expect(result.usernameChangesRemaining).toBe(0);
    expect(result.passwordUsername).toBe(result.handle);
    expect(
      (await auth.login({ username: result.handle!, password: 'Verified Password 19!' }, 'new'))
        .actor.userId,
    ).toBe(member.actor.userId);
    await expect(
      auth.login({ username: 'before_change', password: 'Verified Password 19!' }, 'old'),
    ).rejects.toThrow('INVALID_CREDENTIALS');
    const community = new DemoSnapshotsService(h.db);
    await community.save(member.actor.userId, {
      id: 'try-bypass',
      operations: [
        {
          type: 'profile.save',
          profile: {
            name: '任意昵称',
            bio: '新简介',
            avatar: '',
            school: '',
            campus: '',
            dept: '',
            year: '',
            tags: [],
          },
        },
      ],
    });
    const snapshot = await community.get(member.actor.userId);
    expect(snapshot.userState.profile?.name).toBe(result.handle);
    expect(snapshot.userState.profile?.bio).toBe('新简介');
    expect((await account.overview(member.token)).nickname).toBe(result.handle);
    await expect(
      auth.setPassword(member.token, {
        username: 'bypass_password',
        password: 'Other Password 19!',
      }),
    ).rejects.toThrow('USERNAME_UNAVAILABLE');
  });
  it('keeps collision failures free and resolves case-insensitive concurrent ownership once', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const one = await auth.acceptExternalProof(proof('one@example.com'));
    const two = await auth.acceptExternalProof(proof('two@example.com'));
    const account = new AccountService(h.db);
    const attempts = await Promise.allSettled([
      account.profile(one.token, { handle: 'Same_Name' }),
      account.profile(two.token, { handle: 'same_name' }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const loser = attempts[0]?.status === 'rejected' ? one : two;
    expect((await account.overview(loser.token)).usernameChangesRemaining).toBe(1);
    expect(
      (await account.profile(loser.token, { handle: 'another_name' })).usernameChangesRemaining,
    ).toBe(0);
  });
  it('backfills legacy names, preserves existing handles and spent quota when rerun', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.acceptExternalProof(proof('legacy@example.com'));
    await h.db
      .updateTable('users')
      .set({ handle: null, nickname: '旧昵称', onboarded_at: null })
      .where('id', '=', member.actor.userId)
      .execute();
    await up(h.db);
    const account = new AccountService(h.db);
    const migrated = await account.overview(member.token);
    expect(migrated.nickname).toBe(migrated.handle);
    expect(migrated.usernameChangesRemaining).toBe(1);
    await account.profile(member.token, { handle: 'preserved_name' });
    await up(h.db);
    expect((await account.overview(member.token)).handle).toBe('preserved_name');
    expect((await account.overview(member.token)).usernameChangesRemaining).toBe(0);
  });
});
