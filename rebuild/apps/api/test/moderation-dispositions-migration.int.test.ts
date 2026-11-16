import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { up } from '../src/database/migrations/028_moderation_dispositions.js';

it('migrates legacy limits, preserves sources and permanently merges active duplicates on rerun', async () => {
  const h = await createTestApp();
  try {
    const auth = new PasswordAuthService(h.db);
    const user = await auth.register(
      { username: 'migration_user', password: 'Migration tests 924!' },
      'migration',
    );
    const actionId = randomUUID();
    await h.db
      .insertInto('admin_actions')
      .values({
        id: actionId,
        actor_id: user.actor.userId,
        board: 'daily',
        action: 'restriction',
        target: user.actor.userId,
        reason: '旧社区禁言',
        request_hash: actionId,
        before_data: 'null',
        after_data: JSON.stringify({ hours: 24 }),
        created_at: new Date(),
      })
      .execute();
    await h.db
      .insertInto('community_restrictions')
      .values({
        user_id: user.actor.userId,
        board: 'daily',
        reason: '旧社区禁言',
        until_at: new Date(Date.now() + 86400000),
      })
      .execute();
    const permanent = randomUUID();
    const expired = randomUUID();
    const global = randomUUID();
    for (const penalty of [
      {
        id: permanent,
        board: 'daily',
        capability: 'suspension',
        until_at: null,
        reason: '旧永久封禁',
      },
      {
        id: expired,
        board: 'daily',
        capability: 'publish',
        until_at: new Date(Date.now() - 1000),
        reason: '已到期',
      },
      {
        id: global,
        board: null,
        capability: 'suspension',
        until_at: new Date(Date.now() + 86400000),
        reason: '全站封禁',
      },
    ])
      await h.db
        .insertInto('moderation_penalties')
        .values({
          ...penalty,
          user_id: user.actor.userId,
          revoked_at: null,
          created_at: new Date(),
        })
        .execute();
    const groupId = randomUUID();
    await h.db
      .insertInto('moderation_groups')
      .values({
        id: groupId,
        name: '旧权限',
        boards: '["daily"]',
        permissions: '["users.mute","users.suspend","reports.view"]',
      })
      .execute();
    const appealId = randomUUID();
    await h.db
      .insertInto('moderation_appeals')
      .values({
        id: appealId,
        user_id: user.actor.userId,
        action_id: actionId,
        reason: '旧申诉',
        status: 'pending',
        resolution: '',
        created_at: new Date(),
      })
      .execute();
    await up(h.db);
    const penalties = await h.db.selectFrom('moderation_penalties').selectAll().execute();
    const legacy = penalties.find((penalty) => penalty.source_action_id === actionId)!;
    expect(legacy.reason).toBe('旧社区禁言');
    expect(legacy.superseded_by).toBe(permanent);
    expect(penalties.find((penalty) => penalty.id === permanent)?.capability).toBe('participation');
    expect(penalties.find((penalty) => penalty.id === global)?.capability).toBe('deactivation');
    expect(penalties.find((penalty) => penalty.id === expired)?.superseded_by).toBeNull();
    expect(await h.db.selectFrom('community_restrictions').selectAll().execute()).toHaveLength(0);
    expect(
      (
        await h.db
          .selectFrom('moderation_groups')
          .selectAll()
          .where('id', '=', groupId)
          .executeTakeFirstOrThrow()
      ).permissions,
    ).toBe('["users.manage","reports.view"]');
    expect(
      (
        await h.db
          .selectFrom('moderation_appeals')
          .selectAll()
          .where('id', '=', appealId)
          .executeTakeFirstOrThrow()
      ).action_id,
    ).toBe(actionId);
    const effects = await h.db.selectFrom('moderation_action_effects').selectAll().execute();
    expect(
      effects.some((effect) => effect.action_id === actionId && effect.penalty_id === legacy.id),
    ).toBe(true);
    await up(h.db);
    expect(await h.db.selectFrom('moderation_penalties').selectAll().execute()).toHaveLength(
      penalties.length,
    );
    expect(await h.db.selectFrom('moderation_action_effects').selectAll().execute()).toHaveLength(
      effects.length,
    );
  } finally {
    await h.close();
  }
});
