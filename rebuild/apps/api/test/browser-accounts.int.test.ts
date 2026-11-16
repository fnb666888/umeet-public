import { afterEach, describe, it, expect } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { BrowserAccountService } from '../src/modules/identity/browser-accounts.service.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function fixture() {
  h = await createTestApp();
  const auth = new PasswordAuthService(h.db, 'Browser accounts test');
  const users = [];
  for (let i = 0; i < 6; i++)
    users.push(
      await auth.register(
        { username: 'browser_user_' + i, password: 'Browser test password 84!' },
        'browser-' + i,
      ),
    );
  return { db: h.db, auth, users, browser: new BrowserAccountService(h.db) };
}
describe('remembered browser accounts', () => {
  it('switches A B A without a password, rotates credentials and retains authentication time', async () => {
    const f = await fixture();
    const first = await f.browser.remember('', f.users[0]!.token);
    const second = await f.browser.remember(
      first.deviceToken,
      f.users[1]!.token,
      first.state.version,
    );
    const back = await f.browser.switch(
      first.deviceToken,
      first.state.accounts[0]!.id,
      second.state.version,
    );
    expect(back.auth?.actor.userId).toBe(f.users[0]!.actor.userId);
    expect(back.state.accounts).toHaveLength(2);
    expect(back.auth?.token).not.toBe(first.auth?.token);
    await expect(f.auth.authenticate(second.auth!.token)).rejects.toThrow();
    const session = await f.db
      .selectFrom('sessions')
      .selectAll()
      .where('user_id', '=', f.users[0]!.actor.userId)
      .where('browser_anchor', '=', 1)
      .executeTakeFirstOrThrow();
    const current = await f.db
      .selectFrom('sessions')
      .selectAll()
      .where(
        'browser_login_id',
        '=',
        back.state.accounts.find((a) => a.userId === f.users[0]!.actor.userId)!.id,
      )
      .executeTakeFirstOrThrow();
    expect(current.authenticated_at?.getTime()).toBe(session.authenticated_at?.getTime());
    expect(current.expires_at.getTime()).toBe(session.expires_at.getTime());
  });
  it('enforces five slots, refuses stale versions and never replaces the active account on failure', async () => {
    const f = await fixture();
    let set = await f.browser.remember('', f.users[0]!.token);
    for (let i = 1; i < 5; i++)
      set = await f.browser.remember(set.deviceToken, f.users[i]!.token, set.state.version);
    await expect(
      f.browser.remember(set.deviceToken, f.users[5]!.token, set.state.version),
    ).rejects.toThrow('BROWSER_ACCOUNT_LIMIT');
    expect((await f.browser.list(set.deviceToken, set.auth!.token)).state.currentUserId).toBe(
      f.users[4]!.actor.userId,
    );
    await expect(f.browser.switch(set.deviceToken, set.state.accounts[0]!.id, 0)).rejects.toThrow(
      'BROWSER_CONTEXT_CHANGED',
    );
    const fresh = await f.auth.login(
      { username: 'browser_user_0', password: 'Browser test password 84!' },
      'duplicate',
    );
    const same = await f.browser.remember(set.deviceToken, fresh.token, set.state.version);
    expect(same.state.accounts).toHaveLength(5);
  });
  it('does not revive revoked or expired backing sessions and never accepts their raw tokens', async () => {
    const f = await fixture();
    const a = await f.browser.remember('', f.users[0]!.token);
    await expect(f.auth.authenticate(f.users[0]!.token)).rejects.toThrow();
    const b = await f.browser.remember(a.deviceToken, f.users[1]!.token, a.state.version);
    await f.db.deleteFrom('sessions').where('user_id', '=', f.users[0]!.actor.userId).execute();
    const state = (await f.browser.list(a.deviceToken, b.auth!.token)).state;
    expect(state.accounts.find((x) => x.userId === f.users[0]!.actor.userId)?.status).toBe(
      'expired',
    );
    await expect(
      f.browser.switch(
        a.deviceToken,
        state.accounts.find((x) => x.userId === f.users[0]!.actor.userId)!.id,
        state.version,
      ),
    ).rejects.toThrow('BROWSER_LOGIN_EXPIRED');
  });
  it('removes only one device account and logout-all revokes every saved authorization', async () => {
    const f = await fixture();
    const a = await f.browser.remember('', f.users[0]!.token);
    const b = await f.browser.remember(a.deviceToken, f.users[1]!.token, a.state.version);
    const removed = await f.browser.remove(
      a.deviceToken,
      b.state.accounts.find((x) => x.userId === f.users[0]!.actor.userId)!.id,
      b.state.version,
    );
    expect(removed.state.accounts).toHaveLength(1);
    expect(removed.state.currentUserId).toBe(f.users[1]!.actor.userId);
    await f.browser.logoutAll(a.deviceToken, removed.state.version);
    await expect(f.auth.authenticate(b.auth!.token)).rejects.toThrow();
    expect((await f.browser.list(a.deviceToken, '')).state.accounts).toHaveLength(0);
  });
});
import request from 'supertest';
import { AccountService } from '../src/modules/identity/account.service.js';
import { assertBrowserWriteContext } from '../src/modules/identity/browser-session-state.js';
it('rejects old-page writes even when the browser cookie now belongs to another account', async () => {
  const f = await fixture();
  const a = await f.browser.remember('', f.users[0]!.token);
  const b = await f.browser.remember(a.deviceToken, f.users[1]!.token, a.state.version);
  await expect(
    assertBrowserWriteContext(
      f.db,
      b.auth!.token,
      f.users[0]!.actor.userId,
      String(a.state.version),
      a.deviceToken,
    ),
  ).rejects.toThrow('账号已切换');
  await request(h!.app.getHttpServer())
    .get('/api/v1/auth/me')
    .auth(b.auth!.token, { type: 'bearer' })
    .set('X-Umeet-Account', f.users[0]!.actor.userId)
    .set('X-Umeet-Browser-Version', String(a.state.version))
    .expect(409);
  await request(h!.app.getHttpServer())
    .post('/api/v1/auth/reauth')
    .auth(b.auth!.token, { type: 'bearer' })
    .send({ password: 'Browser test password 84!' })
    .expect(409);
  await request(h!.app.getHttpServer())
    .post('/api/v1/auth/reauth')
    .auth(b.auth!.token, { type: 'bearer' })
    .set('X-Umeet-Account', b.auth!.actor.userId)
    .set('X-Umeet-Browser-Version', String(b.state.version))
    .set('X-Browser-Key', b.deviceToken)
    .send({ password: 'Browser test password 84!' })
    .expect(201);
});
it('shows one current device and preserves its backing authorization when revoking other devices', async () => {
  const f = await fixture();
  const a = await f.browser.remember('', f.users[0]!.token);
  const service = new AccountService(f.db);
  await f.auth.login(
    { username: 'browser_user_0', password: 'Browser test password 84!' },
    'another-device',
  );
  const overview = await service.overview(a.auth!.token);
  expect(overview.sessions).toHaveLength(2);
  expect(overview.sessions.filter((x) => x.current)).toHaveLength(1);
  await service.revoke(a.auth!.token, 'others');
  expect((await service.overview(a.auth!.token)).sessions).toHaveLength(1);
  const again = await f.browser.switch(a.deviceToken, a.state.accounts[0]!.id, a.state.version);
  expect(again.auth!.actor.userId).toBe(f.users[0]!.actor.userId);
  const current = (await service.overview(again.auth!.token)).sessions.find((x) => x.current)!;
  await service.revoke(again.auth!.token, current.id);
  await expect(
    f.browser.switch(a.deviceToken, a.state.accounts[0]!.id, again.state.version),
  ).rejects.toThrow('BROWSER_LOGIN_EXPIRED');
});
it('serializes simultaneous additions so a sixth remembered account cannot slip through', async () => {
  const f = await fixture();
  let set = await f.browser.remember('', f.users[0]!.token);
  for (let i = 1; i < 4; i++)
    set = await f.browser.remember(set.deviceToken, f.users[i]!.token, set.state.version);
  const results = await Promise.allSettled([
    f.browser.remember(set.deviceToken, f.users[4]!.token, set.state.version),
    f.browser.remember(set.deviceToken, f.users[5]!.token, set.state.version),
  ]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect((await f.browser.list(set.deviceToken, '')).state.accounts).toHaveLength(5);
});
it('does not renew recent-authentication by switching and cannot switch to a foreign browser account', async () => {
  const f = await fixture();
  await f.db
    .updateTable('sessions')
    .set({ authenticated_at: new Date(Date.now() - 3600000) })
    .where('user_id', '=', f.users[0]!.actor.userId)
    .execute();
  const a = await f.browser.remember('', f.users[0]!.token);
  const foreign = await f.browser.remember('', f.users[1]!.token);
  await expect(
    f.browser.switch(a.deviceToken, foreign.state.accounts[0]!.id, a.state.version),
  ).rejects.toThrow('BROWSER_ACCOUNT_NOT_SAVED');
  const back = await f.browser.switch(a.deviceToken, a.state.accounts[0]!.id, a.state.version);
  await expect(f.auth.requireRecentMember(back.auth!.token)).rejects.toThrow(
    'REAUTHENTICATION_REQUIRED',
  );
});
it('password changes revoke remembered authorization on other devices without disturbing another saved user', async () => {
  const f = await fixture();
  const a = await f.browser.remember('', f.users[0]!.token);
  const b = await f.browser.remember(a.deviceToken, f.users[1]!.token, a.state.version);
  const remote = await f.auth.login(
    { username: 'browser_user_0', password: 'Browser test password 84!' },
    'remote-password',
  );
  const replacement = await f.auth.setPassword(remote.token, {
    password: 'A new browser password 87!',
  });
  await expect(
    f.browser.switch(a.deviceToken, a.state.accounts[0]!.id, b.state.version),
  ).rejects.toThrow('BROWSER_LOGIN_EXPIRED');
  expect((await f.auth.authenticate(b.auth!.token)).userId).toBe(f.users[1]!.actor.userId);
  const restored = await f.browser.remember(b.deviceToken, replacement.token, b.state.version);
  expect(restored.state.accounts).toHaveLength(2);
  expect(restored.auth!.actor.userId).toBe(f.users[0]!.actor.userId);
});
it('keeps a disabled account identifiable but refuses to activate it', async () => {
  const f = await fixture();
  const a = await f.browser.remember('', f.users[0]!.token);
  const b = await f.browser.remember(a.deviceToken, f.users[1]!.token, a.state.version);
  await f.db
    .updateTable('users')
    .set({ deleted_at: new Date() })
    .where('id', '=', f.users[0]!.actor.userId)
    .execute();
  expect(
    (await f.browser.list(b.deviceToken, b.auth!.token)).state.accounts.find(
      (account) => account.userId === f.users[0]!.actor.userId,
    )?.status,
  ).toBe('blocked');
  await expect(
    f.browser.switch(b.deviceToken, a.state.accounts[0]!.id, b.state.version),
  ).rejects.toThrow('BROWSER_ACCOUNT_BLOCKED');
});
it('unlinking an identity retains the current browser authorization and revokes other devices', async () => {
  const f = await fixture();
  const a = await f.browser.remember('', f.users[0]!.token);
  const remote = await f.auth.login(
    { username: 'browser_user_0', password: 'Browser test password 84!' },
    'unlink-remote',
  );
  await f.db
    .insertInto('external_identities')
    .values({
      provider: 'email',
      subject: 'browser-unlink@example.test',
      user_id: f.users[0]!.actor.userId,
    })
    .execute();
  const account = new AccountService(f.db);
  const identity = (await account.overview(a.auth!.token)).identities[0]!;
  await account.unlink(a.auth!.token, identity.key);
  await expect(f.auth.authenticate(remote.token)).rejects.toThrow();
  expect((await account.overview(a.auth!.token)).sessions).toHaveLength(1);
  expect(
    (await f.browser.switch(a.deviceToken, a.state.accounts[0]!.id, a.state.version)).auth!.actor
      .userId,
  ).toBe(f.users[0]!.actor.userId);
});
