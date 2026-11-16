import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Kysely } from 'kysely';
import { createConnection } from 'mysql2/promise';
import { AppModule } from '../../src/app.module.js';
import { connectDatabase } from '../../src/database/connection.js';
import type { Database } from '../../src/database/database.types.js';
import { migrate } from '../../src/database/migrate.js';
import { moderatorGroupId, moderationOperations } from '../../../../packages/contracts/src/admin.js';
import type { AuthConfiguration } from '../../src/modules/identity/auth-configuration.js';
import type { OtpSenders } from '../../src/modules/identity/otp-sender.js';
export interface TestApp {
  app: INestApplication;
  db: Kysely<Database>;
  close(): Promise<void>;
}
export async function createTestApp(
  authConfiguration: AuthConfiguration = {},
  otpSenders?: OtpSenders,
): Promise<TestApp> {
  const url = new URL(
    process.env['TEST_MYSQL_URL'] || 'mysql://root@127.0.0.1:19316/umeet_rebuild_test',
  );
  const database = url.pathname.slice(1);
  if (
    !/^umeet_rebuild_test(?:_[a-z0-9]+)?$/.test(database) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  )
    throw new Error('UNSAFE_TEST_DATABASE');
  const admin = await createConnection({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  try {
    await admin.query('CREATE DATABASE IF NOT EXISTS `' + database + '` CHARACTER SET utf8mb4');
  } finally {
    await admin.end();
  }
  const db = connectDatabase(url.href);
  try {
    await migrate(db);
    await db.deleteFrom('community_post_bookmarks').execute();
    for(const table of ['interest_votes','interest_polls','interest_comments','interest_actions','interest_reports','interest_news','interest_news_quotas','interest_forecast_runs','interest_forecasts','interest_forecast_days','interest_forecast_templates','interest_sources','interest_preferences','interest_usage'] as const)await db.deleteFrom(table).execute();
    await db.deleteFrom('browser_remembered_logins').execute();
    await db.deleteFrom('browser_login_sets').execute();
    await db.deleteFrom('knowledge_links').execute();
    for (const table of ['knowledge_discussions','knowledge_notification_outbox','knowledge_events','knowledge_disputes','knowledge_route_steps','knowledge_route_revisions','knowledge_routes','knowledge_organization_proposals','knowledge_directory_entries','knowledge_directory_nodes','knowledge_collections','knowledge_spaces','knowledge_revision_relations','knowledge_aliases','knowledge_drafts','knowledge_proposals','knowledge_revisions','knowledge_pages'] as const) await db.deleteFrom(table).execute();
    await db.deleteFrom('runtime_settings').where('id','=','community-application-policy').execute();
    for (const table of ['community_request_events', 'community_requests', 'community_team_members', 'community_teams', 'moderator_board_grants'] as const) await db.deleteFrom(table).execute();
    await db.deleteFrom('post_reviews').execute();
    await db.deleteFrom('registration_invites').execute();
    await db.deleteFrom('moderation_groups').execute();
    await db.insertInto('moderation_groups').values({ id: moderatorGroupId, name: '版主', boards: '[]', permissions: JSON.stringify(moderationOperations) }).execute();
    await db.deleteFrom('moderation_action_effects').execute();
    await db.deleteFrom('moderation_appeals').execute();
    await db.deleteFrom('moderation_penalties').execute();
    await db.deleteFrom('community_restrictions').execute();
    await db.deleteFrom('admin_notifications').execute();
    await db.deleteFrom('admin_actions').execute();
    await db.deleteFrom('admin_report_results').execute();
    await db.deleteFrom('admin_restrictions').execute();
    await db.deleteFrom('admin_visibility').execute();
    await db.deleteFrom('dm_reports').execute();
    await db.deleteFrom('dm_members').execute();
    await db.deleteFrom('dm_conversations').execute();
    await db.deleteFrom('dm_preferences').execute();
    await db.deleteFrom('demo_entities').execute();
    await db.deleteFrom('demo_assets').execute();
    await db.deleteFrom('demo_messages').execute();
    await db.deleteFrom('demo_user_states').execute();
    await db.deleteFrom('demo_operations').execute();
    await db.updateTable('demo_content').set({version:0,data:JSON.stringify({posts:[],comments:{},wiki:[],votes:{},commentVotes:{}}),updated_at:new Date()}).where('id','=','global').execute();
    await db.deleteFrom('discussion_reports').execute();
    await db.deleteFrom('discussion_votes').execute();
    await db.deleteFrom('discussion_comments').where('parent_id', 'is not', null).execute();
    await db.deleteFrom('discussion_comments').execute();
    await db.deleteFrom('discussion_posts').execute();
    await db.deleteFrom('otp_challenges').execute();
    await db.deleteFrom('otp_recipients').execute();
    await db.deleteFrom('otp_delivery_budgets').execute();
    await db.deleteFrom('wiki_links').execute();
    await db.deleteFrom('wiki_revisions').execute();
    await db.deleteFrom('wiki_pages').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('password_credentials').execute();
    await db.deleteFrom('auth_attempts').execute();
    await db.deleteFrom('jobs').execute();
    await db.updateTable('runtime_settings').set({revision:0,value:JSON.stringify({maxFileBytes:100000000,dailyUploadBytes:200000000,uploadsEnabled:true}),updated_at:new Date()}).where('id','=','upload-limits').execute();
    await db.deleteFrom('community_invitations').execute();
    await db.deleteFrom('community_applications').execute();
    await db.deleteFrom('community_roles').execute();
    await db.deleteFrom('wiki_spaces').execute();
    await db.deleteFrom('communities').execute();
    await db.deleteFrom('personal_records').execute();
    await db.deleteFrom('external_identities').execute();
    await db.deleteFrom('platform_roles').execute();
    await db.deleteFrom('audit_events').execute();
    await db.deleteFrom('users').execute();
    const app = await NestFactory.create<NestExpressApplication>(
      AppModule.register(db, authConfiguration, otpSenders),
      { logger: false },
    );
    app.useBodyParser('json', { limit: '8mb' });
    await app.init();
    return {
      app,
      db,
      close: async () => {
        await app.close();
        await db.destroy();
      },
    };
  } catch (error) {
    await db.destroy();
    throw error;
  }
}
