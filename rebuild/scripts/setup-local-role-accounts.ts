/** Configures five owned QA accounts in the disposable Wiki preview database only. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { connectDatabase } from '../apps/api/src/database/connection.js';
import { PasswordAuthService } from '../apps/api/src/modules/identity/password-auth.service.js';
import { moderationAccess, hasModerationPermission } from '../apps/api/src/modules/admin/scope.js';
import {
  boardModerators,
  requireSingleBoardModerator,
} from '../apps/api/src/modules/admin/board-moderators.js';
import {
  moderatorGroupId,
  moderationOperations,
  permits,
} from '../packages/contracts/src/admin.js';
import { AuthResultSchema } from '../packages/contracts/src/index.js';
import { KnowledgeAccess } from '../apps/api/src/modules/knowledge/knowledge-access.js';

if (process.env.NODE_ENV === 'production') throw new Error('LOCAL_TEST_ACCOUNTS_ONLY');
const database = 'umeet_rebuild_test_knowledgebrowser';
const url = 'mysql://root@127.0.0.1:19316/' + database;
const jsonPath = '.runtime/local-role-accounts.json';
const markdownPath = '.runtime/local-role-accounts.md';
const Account = z.object({
  role: z.string(),
  label: z.string(),
  username: z.string(),
  password: z.string(),
  userId: z.string(),
});
const Saved = z.object({
  database: z.literal(database),
  board: z.literal('physics'),
  teamId: z.string(),
  accounts: z.array(Account),
});
const saved = existsSync(jsonPath)
  ? Saved.parse(JSON.parse(readFileSync(jsonPath, 'utf8')) as unknown)
  : null;
const state: z.infer<typeof Saved> = saved ?? {
  database,
  board: 'physics',
  teamId: randomUUID(),
  accounts: [],
};
const definitions = [
  ['admin', '管理员', 'umeet_test_admin'],
  ['moderator', '物理学版主', 'umeet_test_mod'],
  ['assistant', '物理学助手', 'umeet_test_helper'],
  ['member', '普通用户 A', 'umeet_test_user'],
  ['member_b', '普通用户 B', 'umeet_test_user_b'],
] as const;
const db = connectDatabase(url);
const auth = new PasswordAuthService(db, 'Umeet local role setup');
const checkpoint = () => {
  mkdirSync('.runtime', { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(state, null, 2), 'utf8');
};
try {
  const physics = await db
    .selectFrom('communities')
    .select('id')
    .where('slug', '=', 'physics')
    .executeTakeFirst();
  if (!physics)
    throw new Error('RUN_EXISTING_KNOWLEDGE_FIXTURE_FIRST: this command never resets data');
  const group = await db
    .selectFrom('moderation_groups')
    .selectAll()
    .where('id', '=', moderatorGroupId)
    .executeTakeFirstOrThrow();
  const sourcePermissions = z.array(z.string()).parse(JSON.parse(group.permissions) as unknown);
  if (!moderationOperations.every((p) => sourcePermissions.includes(p)))
    throw new Error('MODERATOR_TEMPLATE_IS_RESTRICTED: refusing to change a shared group');
  for (const [role, label, username] of definitions) {
    const old = state.accounts.find((a) => a.role === role);
    const credential = await db
      .selectFrom('password_credentials')
      .select('user_id')
      .where('username', '=', username)
      .executeTakeFirst();
    if (credential) {
      if (!old || old.userId !== credential.user_id)
        throw new Error('REFUSE_TO_REUSE_UNOWNED_ACCOUNT: ' + username);
    } else {
      const password = 'QA!' + randomBytes(18).toString('base64url');
      const result = await auth.register({ username, password }, 'setup-local-roles-' + role);
      await auth.logout(result.token);
      state.accounts = state.accounts.filter((a) => a.role !== role);
      state.accounts.push({ role, label, username, password, userId: result.actor.userId });
      checkpoint();
    }
  }
  const account = (role: string) => state.accounts.find((a) => a.role === role)!;
  const owner = account('moderator'),
    assistant = account('assistant');
  const existingModerator = (await boardModerators(db)).find((row) => row.board === 'physics');
  if (existingModerator && existingModerator.userId !== owner.userId)
    throw new Error('PHYSICS_ALREADY_HAS_ANOTHER_MODERATOR');
  const existingTeam = await db
    .selectFrom('community_teams')
    .selectAll()
    .where('id', '=', state.teamId)
    .executeTakeFirst();
  if (existingTeam && existingTeam.owner_id !== owner.userId)
    throw new Error('TEAM_IS_NOT_OWNED_BY_THIS_FIXTURE');
  const assistantPermissions = [
    'reports.view',
    'reports.dismiss',
    'reports.escalate',
    'content.view',
    'content.delete',
    'content.restore',
    'wiki.view',
    'wiki.edit',
    'history.view',
  ] as const;
  await db.transaction().execute(async (tx) => {
    for (const a of state.accounts) {
      await tx.updateTable('users').set({ nickname: a.label }).where('id', '=', a.userId).execute();
      await tx.deleteFrom('platform_roles').where('user_id', '=', a.userId).execute();
      await tx.deleteFrom('moderation_group_members').where('user_id', '=', a.userId).execute();
      await tx.deleteFrom('moderator_board_grants').where('user_id', '=', a.userId).execute();
      await tx.deleteFrom('community_team_members').where('user_id', '=', a.userId).execute();
      await tx.deleteFrom('community_roles').where('user_id', '=', a.userId).execute();
    }
    await tx
      .insertInto('platform_roles')
      .values({ user_id: account('admin').userId, role: 'admin' })
      .execute();
    await tx
      .insertInto('moderation_group_members')
      .values({
        group_id: moderatorGroupId,
        user_id: owner.userId,
        boards: JSON.stringify(['physics']),
      })
      .execute();
    await tx
      .insertInto('moderator_board_grants')
      .values({
        user_id: owner.userId,
        board: 'physics',
        permissions: JSON.stringify(moderationOperations),
      })
      .execute();
    await tx
      .insertInto('community_roles')
      .values({ user_id: owner.userId, community_id: physics.id, role: 'moderator' })
      .execute();
    const team = {
      id: state.teamId,
      board: 'physics',
      owner_id: owner.userId,
      name: '本地权限测试团队',
      state: 'active',
      version: (existingTeam?.version ?? 0) + 1,
    };
    if (existingTeam)
      await tx.updateTable('community_teams').set(team).where('id', '=', state.teamId).execute();
    else await tx.insertInto('community_teams').values(team).execute();
    await tx
      .insertInto('community_team_members')
      .values({
        team_id: state.teamId,
        user_id: assistant.userId,
        permissions: JSON.stringify(assistantPermissions),
        state: 'active',
        version: 1,
      })
      .execute();
    for (const a of state.accounts)
      await tx
        .insertInto('audit_events')
        .values({
          id: randomUUID(),
          actor_id: null,
          kind: 'identity.local-test-role-configured',
          target_id: a.userId,
          reason: 'Local disposable QA role ' + a.role + '; scope physics',
        })
        .execute();
    await requireSingleBoardModerator(tx);
  });
  for (const a of state.accounts) {
    const login = await auth.login(
      { username: a.username, password: a.password },
      'verify-local-roles-' + a.role,
    );
    const access = await moderationAccess(db, a.userId),
      cap = await new KnowledgeAccess(db).capabilities(
        { actor: login.actor, requestId: 'local-role-verification' },
        physics.id,
      );
    assert.equal(access.admin, a.role === 'admin');
    if (a.role === 'moderator') {
      assert.equal(access.boards.length, 1);
      assert.equal(access.boards[0]?.role, 'moderator');
      assert.equal(hasModerationPermission(access, 'physics', 'teams.manage'), true);
    } else if (a.role === 'assistant') {
      assert.equal(access.boards.length, 1);
      assert.equal(access.boards[0]?.role, 'assistant');
      assert.equal(permits(access.boards[0]?.permissions, 'teams.manage'), false);
      assert.equal(permits(access.boards[0]?.permissions, 'users.manage'), false);
      assert.equal(hasModerationPermission(access, 'daily', 'wiki.edit'), false);
    } else if (a.role.startsWith('member')) {
      assert.equal(access.boards.length, 0);
      assert.equal(cap.canGovernBody, false);
    }
    assert.equal(cap.canGovernBody, !a.role.startsWith('member'));
    const response = await fetch('http://127.0.0.1:3188/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: a.username, password: a.password }),
    });
    assert.equal(response.ok, true, 'Running local preview must accept ' + a.username);
    const served = AuthResultSchema.parse((await response.json()) as unknown);
    assert.equal(served.actor.userId, a.userId, 'Preview database mismatch');
    await auth.logout(login.token);
    await auth.logout(served.token);
  }
  checkpoint();
  const lines = [
    '# 本地测试角色账号',
    '',
    '仅用于 `umeet_rebuild_test_knowledgebrowser`，登录页：http://127.0.0.1:5178/。此文件被 Git 忽略，不用于线上。',
    '',
    '| 角色 | 用户名 | 密码 | 管理范围 |',
    '| --- | --- | --- | --- |',
    ...definitions.map(([role]) => {
      const a = account(role);
      return (
        '| ' +
        [
          a.label,
          a.username,
          a.password,
          role === 'admin'
            ? '全站管理员（不是站点所有者）'
            : role === 'moderator'
              ? '物理学版块版主'
              : role === 'assistant'
                ? '物理学团队助手，按委派权限'
                : '无管理权限',
        ].join(' | ') +
        ' |'
      );
    }),
    '',
    '普通用户 B 可用于检查私信、草稿和他人内容隔离；五个账号正好占用快捷切换列表的五个名额。',
    '',
    '点击头像 → 切换账号 → 添加其他账号。首次为每个账号正常登录一次，以后有效期内点击账号即可切换；最多记住 5 个，同浏览器的 Umeet 标签页会一起切换。',
    '',
    '若运行 `npm run fixture:knowledge` 或 Wiki 浏览器验收重置了该隔离库，再执行 `npm run accounts:local` 即可恢复这些角色账号。',
    '',
  ];
  writeFileSync(markdownPath, lines.join('\n'), 'utf8');
  console.log(
    'Configured and verified five local QA accounts, including real moderator/team-assistant relationships.',
  );
  console.log(
    'Credentials are in ignored .runtime/local-role-accounts.md; no production data or browser cookies were changed.',
  );
} finally {
  await db.destroy();
}
