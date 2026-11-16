import { sql, type Kysely } from 'kysely';
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('runtime_settings')
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('revision', 'integer', (c) => c.notNull())
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('updated_at', sql`datetime(3)`, (c) => c.notNull())
    .execute();
  const initial = JSON.stringify({
    maxFileBytes: 100000000,
    dailyUploadBytes: 200000000,
    uploadsEnabled: true,
  });
  await sql`INSERT INTO runtime_settings (id,revision,value,updated_at) VALUES ('upload-limits',0,${initial},${new Date()})`.execute(
    db,
  );
  await sql`ALTER TABLE jobs MODIFY payload MEDIUMTEXT NOT NULL`.execute(db);
}
