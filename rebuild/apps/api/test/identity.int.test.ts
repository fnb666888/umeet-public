import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
import { requireMember } from '../src/modules/identity/permissions.service.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
describe('business identity, independently of external auth readiness', () => {
  it('treats external subject identifiers as case-sensitive opaque values', async () => {
    h = await createTestApp();
    const service = new IdentityService(h.db);
    const upper = await service.resolve({
      provider: 'test-only:case',
      subject: 'OpenID-Case-Sensitive',
      kind: 'member',
    });
    const lower = await service.resolve({
      provider: 'test-only:case',
      subject: 'openid-case-sensitive',
      kind: 'member',
    });
    expect(lower.userId).not.toBe(upper.userId);
  });
  it('never treats an authenticated guest as a registered member', async () => {
    h = await createTestApp();
    const service = new IdentityService(h.db);
    const guest = await service.resolve({
      provider: 'test-only',
      subject: 'guest-1',
      kind: 'guest',
    });
    expect(guest.kind).toBe('guest');
    expect(() => requireMember({ actor: guest, requestId: '1' })).toThrow(
      'REGISTERED_ACCOUNT_REQUIRED',
    );
    expect(() => requireMember({ actor: null, requestId: '1' })).toThrow('AUTH_REQUIRED');
  });
  it('preserves personal records when a verified identity upgrades in place', async () => {
    h = await createTestApp();
    const service = new IdentityService(h.db);
    const guest = await service.resolve({
      provider: 'test-only',
      subject: 'guest-2',
      kind: 'guest',
    });
    await service.savePersonalRecord(guest, 'draft', 'draft-1', '我的草稿');
    const member = await service.resolve({
      provider: 'test-only',
      subject: 'guest-2',
      kind: 'member',
    });
    expect(member.userId).toBe(guest.userId);
    expect(member.kind).toBe('member');
    expect(await service.readPersonalRecord(member, 'draft', 'draft-1')).toBe('我的草稿');
  });
  it('creates exactly one user for concurrent login and never merges by nickname', async () => {
    h = await createTestApp();
    const service = new IdentityService(h.db);
    const actors = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.resolve({ provider: 'test-only', subject: 'parallel', kind: 'member' }),
      ),
    );
    expect(new Set(actors.map((a) => a.userId)).size).toBe(1);
    const other = await service.resolve({
      provider: 'test-only',
      subject: 'different',
      kind: 'member',
    });
    expect(other.userId).not.toBe(actors[0]?.userId);
  });
  it('does not let another account read or overwrite personal records', async () => {
    h = await createTestApp();
    const service = new IdentityService(h.db);
    const owner = await service.resolve({ provider: 'test-only', subject: 'owner', kind: 'guest' });
    const other = await service.resolve({
      provider: 'test-only',
      subject: 'other',
      kind: 'member',
    });
    await service.savePersonalRecord(owner, 'draft', 'same-key', 'private');
    expect(await service.readPersonalRecord(other, 'draft', 'same-key')).toBeNull();
    await service.savePersonalRecord(other, 'draft', 'same-key', 'own');
    expect(await service.readPersonalRecord(owner, 'draft', 'same-key')).toBe('private');
  });
});
