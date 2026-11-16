import { sql, type Kysely } from 'kysely';
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('sessions')
    .addColumn('authenticated_at', sql`datetime(3)`)
    .execute();
  await sql`ALTER TABLE external_identities MODIFY subject VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`.execute(
    db,
  );
  await db.schema
    .createTable('otp_recipients')
    .addColumn('key_hash', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('next_send_at', sql`datetime(3)`, (c) => c.notNull())
    .addColumn('window_start', sql`datetime(3)`, (c) => c.notNull())
    .addColumn('send_count', 'integer', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('otp_delivery_budgets')
    .addColumn('channel', 'varchar(16)', (c) => c.notNull())
    .addColumn('business_day', 'varchar(10)', (c) => c.notNull())
    .addColumn('send_count', 'integer', (c) => c.notNull())
    .addPrimaryKeyConstraint('otp_budget_pk', ['channel', 'business_day'])
    .execute();
  await db.schema
    .createTable('otp_challenges')
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('channel', 'varchar(16)', (c) => c.notNull())
    .addColumn('recipient', 'varchar(254)', (c) => c.notNull())
    .addColumn('purpose', 'varchar(16)', (c) => c.notNull())
    .addColumn('owner_id', 'varchar(64)', (c) => c.references('users.id'))
    .addColumn('code_hash', 'varchar(64)', (c) => c.notNull())
    .addColumn('expires_at', sql`datetime(3)`, (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('state', 'varchar(16)', (c) => c.notNull())
    .execute();
  await sql`ALTER TABLE otp_challenges MODIFY recipient VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`.execute(
    db,
  );
  await db.schema
    .createIndex('otp_challenge_recipient')
    .on('otp_challenges')
    .columns(['channel', 'recipient', 'purpose', 'state'])
    .execute();
  await db.schema
    .createIndex('otp_challenge_expiry')
    .on('otp_challenges')
    .column('expires_at')
    .execute();
}
