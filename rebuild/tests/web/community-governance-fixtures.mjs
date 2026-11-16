import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { connectDatabase } from '../../apps/api/src/database/connection.ts';
import { migrate } from '../../apps/api/src/database/migrate.ts';
import { PasswordAuthService } from '../../apps/api/src/modules/identity/password-auth.service.ts';

const db = connectDatabase('mysql://root@127.0.0.1:19316/umeet_rebuild_local');
const path = '.runtime/governance-ui-fixture.json';
try {
  await migrate(db);
  if (process.argv[2] === 'setup') {
    if (existsSync(path)) throw new Error('Clean up the previous governance fixture first');
    const suffix = randomUUID().slice(0, 8);
    const auth = new PasswordAuthService(db);
    const password = randomUUID() + 'Aa!';
    const actor = await auth.register(
      { username: 'governance_ui_' + suffix, password },
      'governance-' + suffix,
    );
    const reviewer = await auth.register(
      { username: 'governance_admin_' + suffix, password },
      'governance-admin-' + suffix,
    );
    const userId = actor.actor.userId;
    const assistant = await auth.register(
      { username: 'governance_helper_' + suffix, password },
      'governance-helper-' + suffix,
    );
    await db
      .updateTable('users')
      .set({ created_at: new Date(Date.now() - 31 * 86400000) })
      .where('id', 'in', [userId, assistant.actor.userId])
      .execute();
    await db
      .insertInto('platform_roles')
      .values({ user_id: reviewer.actor.userId, role: 'admin' })
      .execute();
    for (const qualified of [userId, assistant.actor.userId])
      for (let index = 0; index < 5; index++)
        await db
          .insertInto('demo_entities')
          .values({
            id: 'post:qualification-' + qualified + '-' + index,
            kind: 'post',
            data: JSON.stringify({
              id: 'qualification-' + qualified + '-' + index,
              authorId: qualified,
              community: 'daily',
              title: '资格测试帖子',
              body: '仅用于自动验收',
              tags: [],
              likes: 0,
              createdAt: new Date().toISOString(),
            }),
          })
          .execute();
    writeFileSync(
      path,
      JSON.stringify({
        userId,
        username: 'governance_ui_' + suffix,
        password,
        token: actor.token,
        board: 'browser-' + suffix,
        name: '星空观察 ' + suffix,
        reviewer: { userId: reviewer.actor.userId, token: reviewer.token, username: 'governance_admin_' + suffix, password },
        assistant: {
          userId: assistant.actor.userId,
          token: assistant.token,
          username: 'governance_helper_' + suffix,
          password,
        },
      }),
    );
  } else if (process.argv[2] === 'cleanup') {
    if (!existsSync(path)) process.exitCode = 0;
    else {
      const fixture = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
      const board = fixture.board || 'browser-astronomy';
      const users = [
        fixture.userId,
        ...(fixture.reviewer ? [fixture.reviewer.userId] : []),
        ...(fixture.assistant ? [fixture.assistant.userId] : []),
      ];
      await db.transaction().execute(async (tx) => {
        const conversations = await tx.selectFrom('dm_conversations').select('id')
          .where((eb) => eb.or([eb('first_user', 'in', users), eb('second_user', 'in', users)])).execute();
        const conversationIds = conversations.map((row) => row.id);
        if (conversationIds.length) {
          await tx.deleteFrom('dm_members').where('conversation_id', 'in', conversationIds).execute();
          await tx.deleteFrom('demo_messages').where('conversation_id', 'in', conversationIds).execute();
          await tx.deleteFrom('dm_conversations').where('id', 'in', conversationIds).execute();
        }
        await tx.deleteFrom('dm_preferences').where('user_id', 'in', users).execute();
        const teams = await tx
          .selectFrom('community_teams')
          .select('id')
          .where('board', '=', board)
          .execute();
        const requests = await tx
          .selectFrom('community_requests')
          .select('id')
          .where('user_id', 'in', users)
          .execute();
        const requestIds = requests.map((row) => row.id);
        if (requestIds.length)
          await tx
            .deleteFrom('community_request_events')
            .where('request_id', 'in', requestIds)
            .execute();
        await tx.deleteFrom('community_requests').where('user_id', 'in', users).execute();
        if (teams.length)
          await tx
            .deleteFrom('community_team_members')
            .where(
              'team_id',
              'in',
              teams.map((row) => row.id),
            )
            .execute();
        await tx.deleteFrom('community_teams').where('board', '=', board).execute();
        await tx.deleteFrom('moderator_board_grants').where('user_id', 'in', users).execute();
        await tx.deleteFrom('moderation_group_members').where('user_id', 'in', users).execute();
        await tx
          .deleteFrom('admin_actions')
          .where((eb) => eb.or([eb('board', '=', board), eb('actor_id', 'in', users)]))
          .execute();
        await tx.deleteFrom('admin_notifications').where('user_id', 'in', users).execute();
        const entities = await tx.selectFrom('demo_entities').select(['id', 'data']).execute();
        for (const entity of entities)
          if (users.includes(JSON.parse(entity.data).authorId) || users.includes(JSON.parse(entity.data).editorId))
            await tx.deleteFrom('demo_entities').where('id', '=', entity.id).execute();
        await tx.deleteFrom('demo_user_states').where('user_id', 'in', users).execute();
        for (const user of users)
          await tx
            .deleteFrom('demo_operations')
            .where('id', 'like', user + ':%')
            .execute();
        await tx.deleteFrom('sessions').where('user_id', 'in', users).execute();
        await tx.deleteFrom('password_credentials').where('user_id', 'in', users).execute();
        await tx.deleteFrom('platform_roles').where('user_id', 'in', users).execute();
        await tx
          .deleteFrom('audit_events')
          .where((eb) => eb.or([eb('actor_id', 'in', users), eb('target_id', 'in', users)]))
          .execute();
        await tx.deleteFrom('users').where('id', 'in', users).execute();
        const community = await tx
          .selectFrom('communities')
          .select('id')
          .where('slug', '=', board)
          .executeTakeFirst();
        if (community) {
          await tx.deleteFrom('wiki_spaces').where('community_id', '=', community.id).execute();
          await tx.deleteFrom('community_roles').where('community_id', '=', community.id).execute();
          await tx.deleteFrom('communities').where('id', '=', community.id).execute();
        }
        const row = await tx
          .selectFrom('runtime_settings')
          .selectAll()
          .where('id', '=', 'site-settings')
          .forUpdate()
          .executeTakeFirstOrThrow();
        const settings = JSON.parse(row.value);
        delete settings.boards[board];
        await tx
          .updateTable('runtime_settings')
          .set({
            value: JSON.stringify(settings),
            revision: row.revision + 1,
            updated_at: new Date(),
          })
          .where('id', '=', row.id)
          .execute();
      });
      unlinkSync(path);
    }
  } else throw new Error('Expected setup or cleanup');
} finally {
  await db.destroy();
}
