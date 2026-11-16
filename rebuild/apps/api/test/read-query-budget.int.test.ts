import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './support/test-app';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service';
import { AdminService } from '../src/modules/admin/admin.service';

it('checks management eligibility only for the visible page within a bounded query budget', async () => {
  const h = await createTestApp();
  const executor = h.db.getExecutor();
  const original = executor.executeQuery.bind(executor);
  try {
    const owner = await new PasswordAuthService(h.db).register({ username: 'budget_owner', password: 'Budget test password 91!' }, 'budget');
    await h.db.insertInto('platform_roles').values({ user_id: owner.actor.userId, role: 'owner' }).execute();
    await h.db.insertInto('users').values(Array.from({ length: 60 }, (_, index) => ({ id: randomUUID(), kind: 'member' as const, nickname: 'Budget ' + index, handle: 'budget_user_' + index }))).execute();
    let queries = 0;
    executor.executeQuery = async (...args) => { queries++; return original(...args); };
    const page = await new AdminService(h.db).list({ section: 'users', q: '', status: 'all', kind: 'all', page: 1 }, owner.actor.userId);
    expect(page.items).toHaveLength(25);
    expect(page.total).toBe(61);
    console.log('61-user first-page SQL queries:', queries);
    expect(queries).toBeLessThan(100);
  } finally { executor.executeQuery = original; await h.close(); }
});

it('does not reread or update a recently seen session during authentication', async () => {
  const h = await createTestApp();
  const executor = h.db.getExecutor();
  const original = executor.executeQuery.bind(executor);
  try {
    const auth = new PasswordAuthService(h.db);
    const user = await auth.register({ username: 'auth_budget', password: 'Budget test password 91!' }, 'budget');
    let queries = 0;
    executor.executeQuery = async (...args) => { queries++; return original(...args); };
    expect((await auth.authenticate(user.token, true)).userId).toBe(user.actor.userId);
    expect(queries).toBe(2);
  } finally { executor.executeQuery = original; await h.close(); }
});
