import type { Kysely } from 'kysely';
import type { Database } from '../database.types.js';

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable('community_teams')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('board', 'varchar(80)', (c) => c.notNull())
    .addColumn('owner_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('name', 'varchar(120)', (c) => c.notNull())
    .addColumn('state', 'varchar(24)', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('community_team_members')
    .ifNotExists()
    .addColumn('team_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('permissions', 'text', (c) => c.notNull())
    .addColumn('state', 'varchar(24)', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addPrimaryKeyConstraint('community_team_member_pk', ['team_id', 'user_id'])
    .execute();
  await db.schema
    .createTable('moderator_board_grants')
    .ifNotExists()
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('board', 'varchar(80)', (c) => c.notNull())
    .addColumn('permissions', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('moderator_board_grant_pk', ['user_id', 'board'])
    .execute();
  await db.schema
    .createTable('community_requests')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('kind', 'varchar(24)', (c) => c.notNull())
    .addColumn('board', 'varchar(80)', (c) => c.notNull())
    .addColumn('state', 'varchar(24)', (c) => c.notNull())
    .addColumn('data', 'text', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('community_request_events')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('request_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('actor_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('action', 'varchar(32)', (c) => c.notNull())
    .addColumn('reason', 'text', (c) => c.notNull())
    .addColumn('created_at', 'datetime(3)', (c) => c.notNull())
    .execute();
}
