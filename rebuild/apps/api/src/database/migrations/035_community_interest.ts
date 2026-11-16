import type { Kysely } from 'kysely';
import type { Database } from '../database.types.js';
import { interestBoards } from '../../../../../packages/contracts/src/interest.js';

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable('interest_preferences')
    .addColumn('user_id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('data', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'datetime(3)', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('interest_polls')
    .addColumn('id', 'varchar(80)', (c) => c.primaryKey())
    .addColumn('post_id', 'varchar(80)', (c) => c.notNull().unique())
    .addColumn('author_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('question', 'varchar(200)', (c) => c.notNull())
    .addColumn('options', 'text', (c) => c.notNull())
    .addColumn('ends_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('state', 'varchar(24)', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('interest_votes')
    .addColumn('poll_id', 'varchar(80)', (c) => c.notNull())
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('option_id', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .addPrimaryKeyConstraint('interest_vote_pk', ['poll_id', 'user_id'])
    .execute();
  await db.schema
    .createTable('interest_sources')
    .addColumn('id', 'varchar(80)', (c) => c.primaryKey())
    .addColumn('name', 'varchar(100)', (c) => c.notNull())
    .addColumn('board', 'varchar(80)', (c) => c.notNull())
    .addColumn('kind', 'varchar(24)', (c) => c.notNull())
    .addColumn('url', 'varchar(1000)', (c) => c.notNull())
    .addColumn('terms_url', 'varchar(1000)', (c) => c.notNull())
    .addColumn('enabled', 'integer', (c) => c.notNull())
    .addColumn('approved', 'integer', (c) => c.notNull())
    .addColumn('etag', 'varchar(300)')
    .addColumn('last_error', 'varchar(300)', (c) => c.notNull())
    .addColumn('fetched_at', 'datetime(3)')
    .addColumn('due_at', 'datetime(3)', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('interest_news')
    .addColumn('id', 'varchar(80)', (c) => c.primaryKey())
    .addColumn('source_id', 'varchar(80)', (c) => c.notNull())
    .addColumn('external_id', 'varchar(200)', (c) => c.notNull())
    .addColumn('dedup_key', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('title', 'varchar(300)', (c) => c.notNull())
    .addColumn('url', 'varchar(1000)', (c) => c.notNull())
    .addColumn('summary', 'text', (c) => c.notNull())
    .addColumn('board', 'varchar(80)', (c) => c.notNull())
    .addColumn('language', 'varchar(40)', (c) => c.notNull())
    .addColumn('published_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('state', 'varchar(24)', (c) => c.notNull())
    .addUniqueConstraint('interest_source_item', ['source_id', 'external_id'])
    .execute();
  await db.schema
    .createIndex('interest_news_page')
    .on('interest_news')
    .columns(['state', 'created_at', 'id'])
    .execute();
  await db.schema
    .createTable('interest_news_quotas')
    .addColumn('board', 'varchar(80)', (c) => c.notNull())
    .addColumn('business_day', 'varchar(10)', (c) => c.notNull())
    .addColumn('count', 'integer', (c) => c.notNull())
    .addPrimaryKeyConstraint('interest_quota_pk', ['board', 'business_day'])
    .execute();
  await db.schema
    .createTable('interest_forecast_days')
    .addColumn('business_day', 'varchar(10)', (c) => c.primaryKey())
    .addColumn('state', 'varchar(24)', (c) => c.notNull())
    .addColumn('reason', 'varchar(300)', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('updated_at', 'datetime(3)', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('interest_forecast_templates')
    .addColumn('id', 'varchar(80)', (c) => c.primaryKey())
    .addColumn('name', 'varchar(100)', (c) => c.notNull())
    .addColumn('field', 'varchar(24)', (c) => c.notNull())
    .addColumn('board', 'varchar(80)', (c) => c.notNull())
    .addColumn('source_id', 'varchar(80)', (c) => c.notNull())
    .addColumn('target', 'varchar(100)', (c) => c.notNull())
    .addColumn('days_ahead', 'integer', (c) => c.notNull())
    .addColumn('enabled', 'integer', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('interest_forecasts')
    .addColumn('id', 'varchar(80)', (c) => c.primaryKey())
    .addColumn('business_day', 'varchar(10)', (c) => c.notNull().unique())
    .addColumn('template_id', 'varchar(80)', (c) => c.notNull())
    .addColumn('field', 'varchar(24)', (c) => c.notNull())
    .addColumn('board', 'varchar(80)', (c) => c.notNull())
    .addColumn('title', 'varchar(300)', (c) => c.notNull())
    .addColumn('probability', 'double precision', (c) => c.notNull())
    .addColumn('reasoning', 'text', (c) => c.notNull())
    .addColumn('counter_evidence', 'text', (c) => c.notNull())
    .addColumn('evidence', 'text', (c) => c.notNull())
    .addColumn('information_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('deadline', 'datetime(3)', (c) => c.notNull())
    .addColumn('rules', 'text', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('state', 'varchar(24)', (c) => c.notNull())
    .addColumn('outcome', 'integer')
    .addColumn('resolution', 'text', (c) => c.notNull())
    .addColumn('result_evidence', 'text', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('interest_forecast_runs')
    .addColumn('id', 'varchar(80)', (c) => c.primaryKey())
    .addColumn('business_day', 'varchar(10)', (c) => c.notNull())
    .addColumn('state', 'varchar(24)', (c) => c.notNull())
    .addColumn('data', 'text', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('interest_comments')
    .addColumn('id', 'varchar(80)', (c) => c.primaryKey())
    .addColumn('target_type', 'varchar(24)', (c) => c.notNull())
    .addColumn('target_id', 'varchar(80)', (c) => c.notNull())
    .addColumn('author_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .addColumn('hidden', 'integer', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('interest_comment_page')
    .on('interest_comments')
    .columns(['target_type', 'target_id', 'created_at'])
    .execute();
  await db.schema
    .createTable('interest_actions')
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('target_type', 'varchar(24)', (c) => c.notNull())
    .addColumn('target_id', 'varchar(80)', (c) => c.notNull())
    .addColumn('kind', 'varchar(24)', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .addPrimaryKeyConstraint('interest_action_pk', ['user_id', 'target_type', 'target_id', 'kind'])
    .execute();
  await db.schema
    .createTable('interest_reports')
    .addColumn('id', 'varchar(80)', (c) => c.primaryKey())
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('target_type', 'varchar(24)', (c) => c.notNull())
    .addColumn('target_id', 'varchar(80)', (c) => c.notNull())
    .addColumn('comment_id', 'varchar(80)')
    .addColumn('reason', 'text', (c) => c.notNull())
    .addColumn('state', 'varchar(24)', (c) => c.notNull())
    .addColumn('resolution', 'text', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('interest_usage')
    .addColumn('business_day', 'varchar(10)', (c) => c.primaryKey())
    .addColumn('count', 'integer', (c) => c.notNull())
    .execute();
  for (const [offset, board] of interestBoards.entries()) {
    const existing = await db
      .selectFrom('communities')
      .selectAll()
      .where('slug', '=', board.slug)
      .executeTakeFirst();
    // Never overwrite a pre-existing community with the same slug.
    if (existing) continue;
    const communityId = 'interest-' + board.slug;
    await db
      .insertInto('communities')
      .values({ id: communityId, ...board, is_default: 0, display_order: 100 + offset })
      .execute();
    await db
      .insertInto('wiki_spaces')
      .values({ id: 'wiki-' + communityId, community_id: communityId })
      .execute();
  }
}
