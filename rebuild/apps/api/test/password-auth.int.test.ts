import { afterEach, describe, it, expect } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
describe('self-owned real password/session authentication', () => {
  it('hashes passwords and session tokens, allows login, and revokes logout', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const result = await auth.register(
      { username: 'nanxing', password: 'Correct Horse 47!' },
      'client1',
    );
    expect((await auth.authenticate(result.token)).kind).toBe('member');
    const credential = await h.db
      .selectFrom('password_credentials')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(credential.password_hash).not.toContain('Correct Horse');
    expect(credential.password_hash).toMatch(/^scrypt\$/);
    expect(
      (await h.db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow()).token_hash,
    ).not.toBe(result.token);
    const login = await auth.login(
      { username: 'NANXING', password: 'Correct Horse 47!' },
      'client2',
    );
    expect(login.actor.userId).toBe(result.actor.userId);
    await auth.logout(login.token);
    await expect(auth.authenticate(login.token)).rejects.toThrow('AUTH_REQUIRED');
  });
  it('upgrades a real guest without losing draft data and rotates the old token', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db),
      identity = new IdentityService(h.db);
    const guest = await auth.guest('guest-client');
    await identity.savePersonalRecord(guest.actor, 'draft', 'one', '未公开的草稿');
    const member = await auth.register(
      { username: 'guest_upgrade', password: 'My New Password 98!', guestToken: guest.token },
      'register-client',
    );
    expect(member.actor.userId).toBe(guest.actor.userId);
    expect(await identity.readPersonalRecord(member.actor, 'draft', 'one')).toBe('未公开的草稿');
    await expect(auth.authenticate(guest.token)).rejects.toThrow('AUTH_REQUIRED');
  });
  it('rejects wrong passwords, forged tokens and repeated login attempts', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    await auth.register({ username: 'rate_limited', password: 'Valid Password 56!' }, 'register');
    await expect(auth.authenticate('forged')).rejects.toThrow('AUTH_REQUIRED');
    for (let i = 0; i < 5; i++)
      await expect(
        auth.login({ username: 'rate_limited', password: 'wrong' }, 'one-client'),
      ).rejects.toThrow('INVALID_CREDENTIALS');
    await expect(
      auth.login({ username: 'rate_limited', password: 'Valid Password 56!' }, 'one-client'),
    ).rejects.toThrow('TOO_MANY_ATTEMPTS');
  });
  it('merges guest records only after proving the existing account password and preserves conflicting drafts', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db),
      identity = new IdentityService(h.db);
    const member = await auth.register(
      { username: 'returning_user', password: 'An Existing Password 87!' },
      'register',
    );
    const guest = await auth.guest('new-browser');
    await identity.savePersonalRecord(member.actor, 'draft', 'same-page', '正式账号草稿');
    await identity.savePersonalRecord(guest.actor, 'draft', 'same-page', '游客草稿');
    await identity.savePersonalRecord(guest.actor, 'bookmark', 'wiki-one', '词条收藏');
    await expect(
      auth.login(
        { username: 'returning_user', password: 'wrong', guestToken: guest.token },
        'wrong-client',
      ),
    ).rejects.toThrow('INVALID_CREDENTIALS');
    expect(await identity.readPersonalRecord(guest.actor, 'bookmark', 'wiki-one')).toBe('词条收藏');
    const result = await auth.login(
      { username: 'returning_user', password: 'An Existing Password 87!', guestToken: guest.token },
      'proved-client',
    );
    expect(result.actor.userId).toBe(member.actor.userId);
    expect(await identity.readPersonalRecord(result.actor, 'bookmark', 'wiki-one')).toBe(
      '词条收藏',
    );
    const drafts = await h.db
      .selectFrom('personal_records')
      .select('value')
      .where('user_id', '=', member.actor.userId)
      .where('kind', '=', 'draft')
      .execute();
    expect(drafts.map((r) => r.value).sort()).toEqual(['正式账号草稿', '游客草稿'].sort());
    await expect(auth.authenticate(guest.token)).rejects.toThrow('AUTH_REQUIRED');
    expect(
      await h.db
        .selectFrom('personal_records')
        .selectAll()
        .where('user_id', '=', guest.actor.userId)
        .execute(),
    ).toEqual([]);
  });
  it('rejects an expired guest upgrade and revokes expired sessions', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const guest = await auth.guest('expiry-client');
    await h.db
      .updateTable('sessions')
      .set({ expires_at: new Date(0) })
      .execute();
    await expect(auth.authenticate(guest.token)).rejects.toThrow('AUTH_REQUIRED');
    await expect(
      auth.register(
        { username: 'expired_guest', password: 'A Longer Password 77!', guestToken: guest.token },
        'register',
      ),
    ).rejects.toThrow('AUTH_REQUIRED');
    expect(await h.db.selectFrom('password_credentials').selectAll().execute()).toEqual([]);
  });
  it('separates account brute-force limits from a shared website proxy address', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    for (let index = 0; index < 6; index++)
      await auth.register(
        { username: 'shared_proxy_' + index, password: 'A Secure Password 82!' },
        'same-web-proxy',
      );
    for (let index = 0; index < 5; index++)
      await expect(
        auth.login({ username: 'shared_proxy_0', password: 'wrong' }, 'network-' + index),
      ).rejects.toThrow('INVALID_CREDENTIALS');
    await expect(
      auth.login({ username: 'shared_proxy_0', password: 'wrong' }, 'another-network'),
    ).rejects.toThrow('TOO_MANY_ATTEMPTS');
    expect(
      (
        await auth.login(
          { username: 'shared_proxy_1', password: 'A Secure Password 82!' },
          'same-web-proxy',
        )
      ).actor.kind,
    ).toBe('member');
  });
});
