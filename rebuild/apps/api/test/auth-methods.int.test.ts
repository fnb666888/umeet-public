import { AccountService } from '../src/modules/identity/account.service.js';
import { afterEach, describe, it, expect } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
describe('self-service login methods after recent authentication', () => {
  it('rechecks revocation using current rows even if a MySQL transaction has an earlier read snapshot', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.register(
      { username: 'revoked_snapshot', password: 'A Verified Password 19!' },
      'snapshot',
    );
    await h.db.transaction().execute(async (tx) => {
      await tx.selectFrom('sessions').selectAll().execute();
      await auth.logout(member.token);
      await expect(auth.requireRecentMember(member.token, tx)).rejects.toThrow('AUTH_REQUIRED');
    });
  });
  it('allows a verified external account to add a password and revokes old sessions on update', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const original = await auth.acceptExternalProof({
      identities: [{ provider: 'email', subject: 'student@example.com' }],
      nickname: '同学',
    });
    const second = await auth.acceptExternalProof({
      identities: [{ provider: 'email', subject: 'student@example.com' }],
      nickname: '同学',
    });
    await new AccountService(h.db).profile(original.token, { handle: 'email_member' });
    const result = await auth.setPassword(original.token, {
      username: 'email_member',
      password: 'My New Password 58!',
    });
    expect(result.actor.userId).toBe(original.actor.userId);
    await expect(auth.authenticate(original.token)).rejects.toThrow('AUTH_REQUIRED');
    await expect(auth.authenticate(second.token)).rejects.toThrow('AUTH_REQUIRED');
    expect(
      (
        await auth.login(
          { username: 'email_member', password: 'My New Password 58!' },
          'password-proof',
        )
      ).actor.userId,
    ).toBe(original.actor.userId);
    const methods = await auth.listMethods(result.token);
    expect(methods.username).toBe('email_member');
    expect(methods.emails).toEqual(['s***@example.com']);
  });
  it('does not let stale sessions or guests set a password and never steals an existing username', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.register(
      { username: 'owner_one', password: 'Existing Password 12!' },
      'one',
    );
    const other = await auth.register(
      { username: 'owner_two', password: 'Existing Password 34!' },
      'two',
    );
    await expect(
      auth.setPassword(other.token, { username: 'owner_one', password: 'Take This Password 99!' }),
    ).rejects.toThrow('USERNAME_UNAVAILABLE');
    expect(
      (
        await auth.login(
          { username: 'owner_one', password: 'Existing Password 12!' },
          'still-owner',
        )
      ).actor.userId,
    ).toBe(member.actor.userId);
    await h.db
      .updateTable('sessions')
      .set({ authenticated_at: new Date(0) })
      .execute();
    await expect(
      auth.setPassword(member.token, { username: 'owner_one', password: 'Changed Password 65!' }),
    ).rejects.toThrow('REAUTHENTICATION_REQUIRED');
    const guest = await auth.guest('guest');
    await expect(
      auth.setPassword(guest.token, { username: 'nope_guest', password: 'Changed Password 65!' }),
    ).rejects.toThrow('REGISTERED_ACCOUNT_REQUIRED');
  });
});
