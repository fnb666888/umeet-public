import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './support/test-app.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
import { CommunityTeamsService } from '../src/modules/admin/community-teams.js';
import { ApplicationsService } from '../src/modules/communities/applications.service.js';
import { CommunitiesService } from '../src/modules/communities/communities.service.js';
import { getApplicationEligibility } from '../src/modules/communities/application-policy.js';
import { moderatorGroupId, moderationOperations } from '../../../packages/contracts/src/admin.js';
import { moderationAccess, requireAccountManagement } from '../src/modules/admin/scope.js';
import { syncCommunityTeams } from '../src/modules/admin/team-sync.js';
import { assignModeratorBoards } from '../src/modules/admin/groups.js';

it('allows only one moderator and rejects self-service management applications', async () => {
  const h = await createTestApp();
  try {
    const identity = new IdentityService(h.db);
    const actors = await Promise.all(
      ['sole-mod', 'candidate', 'platform', 'other-mod'].map((subject) =>
        identity.resolve({ provider: 'test', subject, kind: 'member' }),
      ),
    );
    const [mod, candidate, admin, other] = actors.map((actor) => actor.userId) as [
      string,
      string,
      string,
      string,
    ];
    await h.db.insertInto('platform_roles').values({ user_id: admin, role: 'admin' }).execute();
    await h.db
      .insertInto('moderation_group_members')
      .values([
        { group_id: moderatorGroupId, user_id: mod, boards: '["daily"]' },
        { group_id: moderatorGroupId, user_id: other, boards: '["questions"]' },
      ])
      .execute();
    await h.db
      .insertInto('runtime_settings')
      .values({
        id: 'community-application-policy',
        value: '{"days":0,"posts":0}',
        revision: 1,
        updated_at: new Date(),
      })
      .execute();
    const service = new ApplicationsService(h.db);
    const data = {
      name: '校园日常',
      description: '',
      rules: [],
      reason: '协助维护',
      plan: '管理讨论',
      experience: '',
      applyModerator: false,
    };
    await expect(
      service.submit(candidate, { id: randomUUID(), kind: 'moderator', board: 'daily', data }),
    ).rejects.toThrow('MANAGEMENT_INVITATION_REQUIRED');
    await expect(assignModeratorBoards(h.db, admin, [other], ['daily'])).rejects.toThrow(
      'BOARD_MODERATOR_EXISTS',
    );
    for (const kind of ['moderator', 'assistant'] as const) {
      await expect(service.submit(candidate, { id: randomUUID(), kind, board: 'market', data }))
        .rejects.toThrow('MANAGEMENT_INVITATION_REQUIRED');
      const id = randomUUID();
      await h.db.insertInto('community_requests').values({
        id, user_id: candidate, kind, board: 'daily', data: JSON.stringify(data),
        state: 'returned', version: 1, created_at: new Date(),
      }).execute();
      for (const action of ['approve', 'resubmit'] as const) {
        await expect(service.change(action === 'approve' ? admin : candidate, {
          id, version: 1, action, reason: '', permissions: [], data,
        })).rejects.toThrow('MANAGEMENT_INVITATION_REQUIRED');
      }
    }
    await expect(service.submit(candidate, {
      id: randomUUID(), kind: 'board', board: 'new-board', data: { ...data, applyModerator: true },
    })).rejects.toThrow('MANAGEMENT_INVITATION_REQUIRED');
  } finally {
    await h.close();
  }
});

it('enforces per-assistant grants, invitation acceptance, exit approval and owner permission loss', async () => {
  const h = await createTestApp();
  try {
    const identity = new IdentityService(h.db);
    const actors = await Promise.all(
      ['mod', 'assistant', 'second', 'ordinary', 'admin'].map((subject) =>
        identity.resolve({ provider: 'test', subject, kind: 'member' }),
      ),
    );
    const [mod, assistant, second, ordinary, admin] = actors.map((actor) => actor.userId) as [
      string,
      string,
      string,
      string,
      string,
    ];
    await h.db.insertInto('platform_roles').values({ user_id: admin, role: 'admin' }).execute();
    await h.db
      .insertInto('moderation_group_members')
      .values({ group_id: moderatorGroupId, user_id: mod, boards: '["daily"]' })
      .execute();
    await h.db
      .insertInto('runtime_settings')
      .values({
        id: 'community-application-policy',
        value: '{"days":0,"posts":0}',
        revision: 1,
        updated_at: new Date(),
      })
      .execute();
    const service = new CommunityTeamsService(h.db),
      id = randomUUID();
    await service.create(mod, { id, board: 'daily', name: '校园助手' });
    await service.manage(mod, {
      teamId: id,
      version: 1,
      action: 'invite',
      userId: assistant,
      permissions: ['users.manage'],
    });
    expect((await moderationAccess(h.db, assistant)).boards).toHaveLength(0);
    await service.respond(assistant, { teamId: id, version: 1, action: 'accept' });
    await expect(
      service.respond(assistant, { teamId: id, version: 1, action: 'accept' }),
    ).resolves.toEqual({ version: 2 });
    expect((await moderationAccess(h.db, assistant)).boards[0]).toMatchObject({
      board: 'daily',
      role: 'assistant',
    });
    await expect(requireAccountManagement(h.db, mod, assistant, 'daily')).resolves.toBeUndefined();
    await expect(
      requireAccountManagement(h.db, assistant, ordinary, 'daily'),
    ).resolves.toBeUndefined();
    await service.manage(mod, {
      teamId: id,
      version: 3,
      action: 'invite',
      userId: second,
      permissions: ['reports.view'],
    });
    await expect(
      service.manage(mod, {
        teamId: id,
        version: 3,
        action: 'invite',
        userId: second,
        permissions: ['reports.view'],
      }),
    ).resolves.toEqual({ version: 4 });
    await service.respond(second, { teamId: id, version: 1, action: 'accept' });
    await expect(requireAccountManagement(h.db, assistant, second, 'daily')).rejects.toThrow(
      'ADMIN_ACCOUNT_PROTECTED',
    );
    await expect(
      service.create(assistant, { id: randomUUID(), board: 'daily', name: '下级团队' }),
    ).rejects.toThrow('MODERATOR_REQUIRED');
    await expect(
      service.manage(mod, {
        teamId: id,
        version: 5,
        action: 'permissions',
        userId: assistant,
        permissions: ['appeals.review'],
      }),
    ).rejects.toThrow('PERMISSION_ESCALATION');
    await service.respond(assistant, { teamId: id, version: 2, action: 'request-exit' });
    expect((await moderationAccess(h.db, assistant)).boards).toHaveLength(1);
    await service.manage(mod, {
      teamId: id,
      version: 6,
      action: 'approve-exit',
      userId: assistant,
      permissions: [],
    });
    expect((await moderationAccess(h.db, assistant)).boards).toHaveLength(0);
    await h.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('moderation_group_members').where('user_id', '=', mod).execute();
      await syncCommunityTeams(tx);
    });
    expect((await moderationAccess(h.db, second)).boards).toHaveLength(0);
    expect(
      (
        await h.db
          .selectFrom('community_teams')
          .select('state')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).state,
    ).toBe('suspended');
    await h.db
      .insertInto('moderation_group_members')
      .values({ group_id: moderatorGroupId, user_id: ordinary, boards: '["daily"]' })
      .execute();
    const suspended = await h.db
      .selectFrom('community_teams')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    await service.manage(admin, {
      teamId: id,
      version: suspended.version,
      action: 'transfer',
      userId: ordinary,
      permissions: [],
    });
    expect((await moderationAccess(h.db, second)).boards).toHaveLength(1);
    await h.db
      .insertInto('moderation_penalties')
      .values({
        id: randomUUID(),
        user_id: second,
        board: 'daily',
        capability: 'warning',
        reason: '仅警告',
        until_at: null,
        revoked_at: null,
        created_at: new Date(),
      })
      .execute();
    expect((await moderationAccess(h.db, second)).boards).toHaveLength(1);
    expect((await getApplicationEligibility(h.db, second)).eligible).toBe(true);
    await h.db
      .insertInto('community_restrictions')
      .values({
        user_id: second,
        board: 'daily',
        until_at: new Date(Date.now() + 86400000),
        reason: '暂停权限',
      })
      .execute();
    expect((await moderationAccess(h.db, second)).boards).toHaveLength(0);
    await h.db.deleteFrom('community_restrictions').where('user_id', '=', second).execute();
    expect((await moderationAccess(h.db, second)).boards).toHaveLength(1);
    await h.db
      .insertInto('moderator_board_grants')
      .values({ user_id: ordinary, board: 'daily', permissions: '["teams.manage","history.view"]' })
      .execute();
    await h.db.transaction().execute(syncCommunityTeams);
    expect((await moderationAccess(h.db, second)).boards).toHaveLength(0);
    const member = await h.db
      .selectFrom('community_team_members')
      .selectAll()
      .where('team_id', '=', id)
      .where('user_id', '=', second)
      .executeTakeFirstOrThrow();
    expect(JSON.parse(member.permissions)).toEqual([]);
  } finally {
    await h.close();
  }
});

it('checks shared eligibility and approves a new board without granting moderator rights', async () => {
  const h = await createTestApp();
  try {
    await new CommunitiesService(h.db).seedDefaults();
    const identity = new IdentityService(h.db);
    const applicant = await identity.resolve({
      provider: 'test',
      subject: 'applicant',
      kind: 'member',
    });
    const admin = await identity.resolve({ provider: 'test', subject: 'admin', kind: 'member' });
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin.userId, role: 'admin' })
      .execute();
    expect((await getApplicationEligibility(h.db, applicant.userId)).eligible).toBe(false);
    await h.db
      .updateTable('users')
      .set({ created_at: new Date(Date.now() - 31 * 86400000) })
      .where('id', '=', applicant.userId)
      .execute();
    for (let i = 0; i < 5; i++)
      await h.db
        .insertInto('demo_entities')
        .values({
          id: 'post:qualification-' + i,
          kind: 'post',
          data: JSON.stringify({ authorId: applicant.userId }),
        })
        .execute();
    expect((await getApplicationEligibility(h.db, applicant.userId)).eligible).toBe(true);
    const service = new ApplicationsService(h.db),
      id = randomUUID();
    const data = {
      name: '天文',
      description: '观星',
      rules: ['文明讨论'],
      reason: '分享观测',
      plan: '共同维护',
      experience: '',
      applyModerator: false,
    };
    await service.submit(applicant.userId, { id, kind: 'board', board: 'astronomy', data });
    await service.change(admin.userId, {
      id,
      version: 1,
      action: 'return',
      reason: '补充规则',
      permissions: [],
    });
    await service.change(applicant.userId, {
      id,
      version: 2,
      action: 'resubmit',
      reason: '',
      data,
      permissions: [],
    });
    await h.db
      .insertInto('admin_visibility')
      .values({ target: 'post:qualification-0', hidden: 1 })
      .execute();
    await expect(
      service.change(admin.userId, {
        id,
        version: 3,
        action: 'approve',
        reason: '',
        permissions: [],
      }),
    ).rejects.toThrow();
    await h.db.deleteFrom('admin_visibility').execute();
    await service.change(admin.userId, {
      id,
      version: 3,
      action: 'approve',
      reason: '通过',
      permissions: [],
    });
    await expect(
      service.change(admin.userId, {
        id,
        version: 3,
        action: 'approve',
        reason: '通过',
        permissions: [],
      }),
    ).resolves.toMatchObject({ state: 'approved', version: 4 });
    expect((await moderationAccess(h.db, applicant.userId)).boards).toHaveLength(0);
    expect((await service.list(admin.userId, true)).some(row => row.kind === 'moderator')).toBe(false);
  } finally {
    await h.close();
  }
});
