import type { Kysely } from 'kysely';

export async function up<DB>(db: Kysely<DB>) {
  await db.schema
    .alterTable('moderation_appeals')
    .dropIndex('action_id')
    .execute()
    .catch((error: unknown) => {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ER_CANT_DROP_FIELD_OR_KEY'
      ))
        throw error;
    });
  await db.schema
    .createIndex('appeal_user_action')
    .on('moderation_appeals')
    .columns(['user_id', 'action_id'])
    .unique()
    .execute()
    .catch((error: unknown) => {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ER_DUP_KEYNAME'
      ))
        throw error;
    });
}
