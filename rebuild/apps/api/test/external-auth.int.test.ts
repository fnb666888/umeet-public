import { afterEach, describe, it, expect } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
const proof = {
  identities: [{ provider: 'test-only:wechat', subject: 'openid-1' }],
  nickname: '微信用户',
};
describe('self-owned sessions after external verification', () => {
  it('does not upgrade a guest whose session was revoked after an earlier transaction snapshot', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db),
      guest = await auth.guest('revoked-guest');
    await h.db.transaction().execute(async (tx) => {
      await tx.selectFrom('sessions').selectAll().execute();
      await auth.logout(guest.token);
      await expect(auth.acceptExternalProof(proof, guest.token, tx)).rejects.toThrow(
        'AUTH_REQUIRED',
      );
    });
  });
  it('does not merge a mapped guest into itself or erase its records', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db),
      records = new IdentityService(h.db);
    const guest = await auth.guest('mapped-guest');
    await h.db
      .insertInto('external_identities')
      .values({ ...proof.identities[0]!, user_id: guest.actor.userId })
      .execute();
    await records.savePersonalRecord(guest.actor, 'draft', 'keep', '不能删除');
    const result = await auth.acceptExternalProof(proof, guest.token);
    expect(result.actor.userId).toBe(guest.actor.userId);
    expect(await records.readPersonalRecord(result.actor, 'draft', 'keep')).toBe('不能删除');
  });
  it('upgrades a guest in place, keeps drafts and rotates its session after verified WeChat login', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db),
      records = new IdentityService(h.db);
    const guest = await auth.guest('wx-browser');
    await records.savePersonalRecord(guest.actor, 'draft', 'one', '保留草稿');
    const result = await auth.acceptExternalProof(proof, guest.token);
    expect(result.actor.userId).toBe(guest.actor.userId);
    expect(result.actor.kind).toBe('member');
    expect(await records.readPersonalRecord(result.actor, 'draft', 'one')).toBe('保留草稿');
    await expect(auth.authenticate(guest.token)).rejects.toThrow('AUTH_REQUIRED');
    expect(await auth.authenticate(result.token)).toEqual(result.actor);
  });
  it('deduplicates concurrent verified login and joins explicit provider aliases to the same account', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const identities = [
      ...proof.identities,
      { provider: 'test-only:wechat-union', subject: 'union-1' },
    ];
    const results = await Promise.all(
      [0, 1, 2, 3].map(() => auth.acceptExternalProof({ ...proof, identities })),
    );
    expect(new Set(results.map((r) => r.actor.userId)).size).toBe(1);
    const website = await auth.acceptExternalProof({
      nickname: '微信用户',
      identities: [{ provider: 'test-only:wechat-web', subject: 'web-openid' }, identities[1]!],
    });
    expect(website.actor.userId).toBe(results[0]!.actor.userId);
  });
  it('merges a returning guest only into a proven existing identity and refuses conflicting account mappings', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db),
      records = new IdentityService(h.db);
    const existing = await auth.acceptExternalProof(proof);
    const guest = await auth.guest('returning-browser');
    await records.savePersonalRecord(guest.actor, 'bookmark', 'wiki-one', '收藏');
    const result = await auth.acceptExternalProof(proof, guest.token);
    expect(result.actor.userId).toBe(existing.actor.userId);
    expect(await records.readPersonalRecord(result.actor, 'bookmark', 'wiki-one')).toBe('收藏');
    await expect(
      records.savePersonalRecord(guest.actor, 'draft', 'late', '不能在已合并游客上补写'),
    ).rejects.toThrow('GUEST_ALREADY_MERGED');
    await auth.acceptExternalProof({
      nickname: '另一个人',
      identities: [{ provider: 'test-only:wechat-web', subject: 'other-user' }],
    });
    await expect(
      auth.acceptExternalProof({
        nickname: '不能隐式合并正式账号',
        identities: [
          ...proof.identities,
          { provider: 'test-only:wechat-web', subject: 'other-user' },
        ],
      }),
    ).rejects.toThrow('IDENTITY_ACCOUNT_CONFLICT');
  });
});
