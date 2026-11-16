import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { connectDatabase } from '../../apps/api/src/database/connection.ts';
import { PasswordAuthService } from '../../apps/api/src/modules/identity/password-auth.service.ts';

const db = connectDatabase('mysql://root@127.0.0.1:19316/umeet_rebuild_local');
const fixturePath = '.runtime/disposition-ui-fixture.json';
try {
  if (process.argv[2] === 'setup') {
    const suffix = randomUUID().slice(0, 8);
    const password = randomUUID() + 'Ab!';
    const auth = new PasswordAuthService(db);
    const username = 'disposition_ui_' + suffix;
    const reviewerName = 'disposition_reviewer_' + suffix;
    const author = await auth.register({ username, password }, 'disposition-browser');
    const reviewer = await auth.register(
      { username: reviewerName, password },
      'disposition-browser-reviewer',
    );
    await db
      .insertInto('platform_roles')
      .values({ user_id: reviewer.actor.userId, role: 'admin' })
      .execute();
    writeFileSync(
      fixturePath,
      JSON.stringify({
        username,
        password,
        userId: author.actor.userId,
        postId: 'disposition-ui-' + suffix,
        reviewer: { username: reviewerName, password, userId: reviewer.actor.userId },
      }),
    );
  } else if (process.argv[2] === 'cleanup') {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8').replace(/^﻿/, ''));
    const userIds = [fixture.userId, fixture.reviewer.userId];
    await db.transaction().execute(async (tx) => {
      const actions = await tx
        .selectFrom('admin_actions')
        .select('id')
        .where((eb) =>
          eb.or([
            eb('actor_id', 'in', userIds),
            eb('target', 'in', [...userIds, 'post:' + fixture.postId]),
          ]),
        )
        .execute();
      const ids = actions.map((action) => action.id);
      if (ids.length) {
        await tx.deleteFrom('moderation_action_effects').where('action_id', 'in', ids).execute();
        await tx.deleteFrom('moderation_appeals').where('action_id', 'in', ids).execute();
        for (const id of ids)
          await tx
            .deleteFrom('admin_notifications')
            .where('id', 'like', id + ':%')
            .execute();
        await tx.deleteFrom('admin_actions').where('id', 'in', ids).execute();
      }
      if (fixture.reportId) {
        await tx
          .deleteFrom('admin_report_results')
          .where('report_id', '=', fixture.reportId)
          .execute();
        await tx.deleteFrom('demo_entities').where('id', '=', fixture.reportId).execute();
      }
      await tx
        .deleteFrom('admin_visibility')
        .where('target', '=', 'post:' + fixture.postId)
        .execute();
      await tx
        .deleteFrom('demo_entities')
        .where('id', '=', 'post:' + fixture.postId)
        .execute();
      await tx.deleteFrom('moderation_penalties').where('user_id', 'in', userIds).execute();
      await tx.deleteFrom('admin_notifications').where('user_id', 'in', userIds).execute();
      await tx.deleteFrom('demo_user_states').where('user_id', 'in', userIds).execute();
      for (const id of userIds)
        await tx
          .deleteFrom('demo_operations')
          .where('id', 'like', id + ':%')
          .execute();
      await tx.deleteFrom('sessions').where('user_id', 'in', userIds).execute();
      await tx.deleteFrom('password_credentials').where('user_id', 'in', userIds).execute();
      await tx.deleteFrom('platform_roles').where('user_id', 'in', userIds).execute();
      await tx
        .deleteFrom('audit_events')
        .where((eb) => eb.or([eb('actor_id', 'in', userIds), eb('target_id', 'in', userIds)]))
        .execute();
      await tx.deleteFrom('users').where('id', 'in', userIds).execute();
    });
  } else throw new Error('Expected setup or cleanup');
} finally {
  await db.destroy();
}
