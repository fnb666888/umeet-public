import { expect, it } from 'vitest';
import { DispositionInput, AdminActionSchema } from '../src/admin.js';
import { normalizePermissions, permits } from '../src/moderation-permissions.js';

it('validates participation durations, scope and deactivation', () => {
  const input = {
    kind: 'participation',
    scope: 'community',
    board: 'daily',
    hours: 24,
    expectedVersion: null,
  };
  for (const hours of [24, 168, 720, 8760, null])
    expect(DispositionInput.safeParse({ ...input, hours }).success).toBe(true);
  for (const hours of [0, -1, 8761, 1.5])
    expect(DispositionInput.safeParse({ ...input, hours }).success).toBe(false);
  expect(DispositionInput.safeParse({ ...input, kind: 'deactivation' }).success).toBe(false);
  expect(DispositionInput.safeParse({ ...input, scope: 'global' }).success).toBe(false);
  expect(
    AdminActionSchema.safeParse({
      id: crypto.randomUUID(),
      action: 'disposition',
      target: 'user',
      disposition: input,
      reason: '',
    }).success,
  ).toBe(false);
});

it('unifies legacy user permissions and required view access', () => {
  expect(normalizePermissions(['users.mute'])).toEqual(['users.manage', 'users.view']);
  expect(normalizePermissions(['users.suspend'])).toEqual(['users.manage', 'users.view']);
  expect(permits(['users.manage'], 'users.mute')).toBe(true);
  expect(permits(['users.view'], 'users.manage')).toBe(false);
});
