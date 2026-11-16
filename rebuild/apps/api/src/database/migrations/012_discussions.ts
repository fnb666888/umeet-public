import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('discussion_posts')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('community_id', 'varchar(64)', (c) => c.notNull().references('communities.id'))
    .addColumn('author_id', 'varchar(64)', (c) => c.notNull().references('users.id'))
    .addColumn('title', 'varchar(160)', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('state', 'varchar(16)', (c) => c.notNull())
    .addColumn('created_at', sql`datetime(3)`, (c) => c.notNull())
    .addColumn('published_at', sql`datetime(3)`)
    .execute();
  await db.schema
    .createTable('discussion_comments')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('post_id', 'varchar(64)', (c) => c.notNull().references('discussion_posts.id'))
    .addColumn('author_id', 'varchar(64)', (c) => c.notNull().references('users.id'))
    .addColumn('parent_id', 'varchar(64)', (c) => c.references('discussion_comments.id'))
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('state', 'varchar(16)', (c) => c.notNull())
    .addColumn('created_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('discussion_votes')
    .ifNotExists()
    .addColumn('post_id', 'varchar(64)', (c) => c.notNull().references('discussion_posts.id'))
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull().references('users.id'))
    .addColumn('value', 'integer', (c) => c.notNull())
    .addPrimaryKeyConstraint('discussion_vote_pk', ['post_id', 'user_id'])
    .execute();
  await db.schema
    .createTable('discussion_reports')
    .ifNotExists()
    .addColumn('post_id', 'varchar(64)', (c) => c.notNull().references('discussion_posts.id'))
    .addColumn('user_id', 'varchar(64)', (c) => c.notNull().references('users.id'))
    .addColumn('reason', 'varchar(500)', (c) => c.notNull())
    .addPrimaryKeyConstraint('discussion_report_pk', ['post_id', 'user_id'])
    .execute();
}
