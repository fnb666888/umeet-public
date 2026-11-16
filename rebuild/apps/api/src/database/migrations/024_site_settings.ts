import { sql, type Kysely } from 'kysely';
import { defaultSiteSettings } from '../../../../../packages/contracts/src/site-settings-defaults.js';

export async function up(db: Kysely<unknown>) {
  await sql`INSERT INTO runtime_settings (id, revision, value, updated_at)
    VALUES ('site-settings', 0, ${JSON.stringify(defaultSiteSettings)}, ${new Date()})
    ON DUPLICATE KEY UPDATE id = id`.execute(db);
}
