import { sql, type Kysely } from 'kysely';
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('demo_entities')
    .ifNotExists()
    .addColumn('id', 'varchar(150)', (c) => c.primaryKey())
    .addColumn('kind', 'varchar(20)', (c) => c.notNull())
    .addColumn('data', sql`mediumtext`, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('demo_assets')
    .ifNotExists()
    .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('data', sql`mediumtext`, (c) => c.notNull())
    .execute();
}
