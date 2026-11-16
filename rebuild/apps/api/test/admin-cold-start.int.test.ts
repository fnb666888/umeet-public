import { expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { createTestApp } from './support/test-app';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service';
import { BrowserAccountService } from '../src/modules/identity/browser-accounts.service';
import { AdminController } from '../src/modules/admin/admin.controller';
import { AdminService } from '../src/modules/admin/admin.service';

it('bounds the cold admin path with remote database latency', async () => {
  const h = await createTestApp();
  const executor = h.db.getExecutor(), original = executor.executeQuery.bind(executor);
  try {
    const user = await new PasswordAuthService(h.db).register({ username: 'cold_owner', password: 'Cold start password 91!' }, 'cold');
    await h.db.insertInto('platform_roles').values({ user_id: user.actor.userId, role: 'owner' }).execute();
    const browsers = new BrowserAccountService(h.db);
    const remembered = await browsers.remember('', user.token);
    const token = remembered.auth!.token;
    let queries = 0;
    executor.executeQuery = async (...args) => { queries++; await new Promise(resolve => setTimeout(resolve, 140)); return original(...args); };
    const controller = new AdminController(h.db, new AdminService(h.db));
    const req = { headers: { authorization: 'Bearer ' + token } };
    const started = performance.now();
    await browsers.list(remembered.deviceToken, token);
    await controller.access(req);
    await controller.list(req, { section: 'reports', status: 'pending' });
    const baseline = { ms: Math.round(performance.now() - started), queries };
    queries = 0;
    const next = performance.now();
    const context = await browsers.context(remembered.deviceToken, token);
    const bootstrap = await controller.bootstrap(req, { section: 'reports', status: 'pending' });
    const optimized = { ms: Math.round(performance.now() - next), queries };
    console.log('cold admin at 140ms/SQL', JSON.stringify({ baseline, optimized }));
    await writeFile('.runtime/admin-cold-sql.json', JSON.stringify({ latencyPerQueryMs: 140, baseline, optimized }, null, 2));
    expect(context.state.currentUserId).toBe(user.actor.userId);
    expect(context.state.accounts).toEqual([]);
    expect(bootstrap.access.admin).toBe(true);
    expect(bootstrap.list.items).toEqual([]);
    expect(optimized.ms).toBeLessThan(baseline.ms * 0.75);
    await h.db.deleteFrom('platform_roles').where('user_id', '=', user.actor.userId).execute();
    await expect(controller.bootstrap(req, { section: 'reports' })).rejects.toThrow();
    await h.db.deleteFrom('sessions').execute();
    await expect(browsers.context(remembered.deviceToken, token)).rejects.toThrow();
  } finally { executor.executeQuery = original; await h.close(); }
});
