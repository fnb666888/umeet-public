import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types.js';

export async function up(db: Kysely<Database>) {
  const tables = await db.introspection.getTables();
  const columns = tables.find((table) => table.name === 'moderation_penalties')!.columns;
  for (const column of ['source_action_id', 'superseded_by'] as const)
    if (!columns.some((item) => item.name === column))
      await db.schema.alterTable('moderation_penalties').addColumn(column, 'varchar(64)').execute();
  await db.schema
    .createTable('moderation_action_effects')
    .ifNotExists()
    .addColumn('id', 'varchar(100)', (c) => c.primaryKey())
    .addColumn('action_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('type', 'varchar(32)', (c) => c.notNull())
    .addColumn('target', 'varchar(150)', (c) => c.notNull())
    .addColumn('board', 'varchar(32)')
    .addColumn('penalty_id', 'varchar(64)')
    .addColumn('before_data', sql.raw('longtext'), (c) => c.notNull())
    .addColumn('after_data', sql.raw('longtext'), (c) => c.notNull())
    .addColumn('reversed_by', 'varchar(64)')
    .addColumn('created_at', sql.raw('datetime(3)'), (c) => c.notNull())
    .execute();
  const indexes = await sql<{
    Key_name: string;
  }>`SHOW INDEX FROM moderation_action_effects`.execute(db);
  if (!indexes.rows.some((index) => index.Key_name === 'moderation_effect_action'))
    await db.schema
      .createIndex('moderation_effect_action')
      .on('moderation_action_effects')
      .column('action_id')
      .execute();
  await db.transaction().execute(async (tx) => {
    const actions = await tx.selectFrom('admin_actions').selectAll().execute();
    const penalties = await tx.selectFrom('moderation_penalties').selectAll().execute();
    for (const penalty of penalties) {
      const capability =
        penalty.capability === 'publish' || (penalty.board && penalty.capability === 'suspension')
          ? 'participation'
          : penalty.capability === 'suspension'
            ? 'deactivation'
            : penalty.capability;
      await tx
        .updateTable('moderation_penalties')
        .set({ capability, source_action_id: penalty.source_action_id || penalty.id })
        .where('id', '=', penalty.id)
        .execute();
    }
    for (const table of ['admin_restrictions', 'community_restrictions'] as const) {
      const restrictions = await tx.selectFrom(table).selectAll().execute();
      for (const restriction of restrictions) {
        const board = 'board' in restriction ? (restriction.board as string) : null;
        const digest = createHash('sha256')
          .update(table + ':' + restriction.user_id + ':' + board)
          .digest('hex');
        const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        const original = actions
          .filter((action) => {
            const payload = JSON.parse(action.after_data);
            return (
              action.board === board &&
              action.reason === restriction.reason &&
              ((action.action === 'restriction' && action.target === restriction.user_id) ||
                (action.action === 'case.resolve' &&
                  payload.hours &&
                  !payload.penaltyId &&
                  Array.isArray(JSON.parse(action.before_data)) &&
                  JSON.parse(action.before_data).some(
                    (item: { authorId: string }) => item.authorId === restriction.user_id,
                  )))
            );
          })
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
        await tx
          .insertInto('moderation_penalties')
          .values({
            id,
            user_id: restriction.user_id,
            board,
            capability: 'participation',
            reason: restriction.reason,
            until_at: restriction.until_at,
            revoked_at: null,
            source_action_id: original?.id || id,
            superseded_by: null,
            created_at: original?.created_at || new Date(),
          })
          .ignore()
          .execute();
      }
    }
    const converted = await tx.selectFrom('moderation_penalties').selectAll().execute();
    const groups = new Map<string, typeof converted>();
    for (const penalty of converted) {
      if (
        penalty.revoked_at ||
        penalty.superseded_by ||
        (penalty.until_at && penalty.until_at <= new Date()) ||
        !['participation', 'deactivation'].includes(penalty.capability)
      )
        continue;
      const key = JSON.stringify([penalty.user_id, penalty.board, penalty.capability]);
      groups.set(key, [...(groups.get(key) || []), penalty]);
    }
    for (const group of groups.values()) {
      group.sort(
        (a, b) =>
          (b.until_at?.getTime() ?? Infinity) - (a.until_at?.getTime() ?? Infinity) ||
          a.id.localeCompare(b.id),
      );
      for (const old of group.slice(1))
        await tx
          .updateTable('moderation_penalties')
          .set({ superseded_by: group[0]!.id })
          .where('id', '=', old.id)
          .execute();
    }
    for (const penalty of converted) {
      await tx
        .insertInto('moderation_action_effects')
        .values({
          id: penalty.id + ':user',
          action_id: penalty.source_action_id || penalty.id,
          type: penalty.capability,
          target: penalty.user_id,
          board: penalty.board,
          penalty_id: penalty.id,
          before_data: 'null',
          after_data: JSON.stringify({
            reason: penalty.reason,
            until: penalty.until_at?.toISOString() || null,
          }),
          reversed_by: penalty.revoked_at ? 'legacy' : null,
          created_at: penalty.created_at,
        })
        .ignore()
        .execute();
    }
    for (const action of actions) {
      const payload = JSON.parse(action.after_data);
      if ((action.action === 'visibility' || action.action === 'case.resolve') && payload.hidden)
        await tx
          .insertInto('moderation_action_effects')
          .values({
            id: action.id + ':content',
            action_id: action.id,
            type: 'content.delete',
            target: action.target,
            board: action.board,
            penalty_id: null,
            before_data: action.before_data,
            after_data: action.after_data,
            reversed_by: null,
            created_at: action.created_at,
          })
          .ignore()
          .execute();
    }
    for (const group of await tx.selectFrom('moderation_groups').selectAll().execute()) {
      const permissions = (JSON.parse(group.permissions) as string[]).map((value) =>
        ['users.mute', 'users.suspend'].includes(value) ? 'users.manage' : value,
      );
      await tx
        .updateTable('moderation_groups')
        .set({ permissions: JSON.stringify([...new Set(permissions)]) })
        .where('id', '=', group.id)
        .execute();
    }
    await tx.deleteFrom('community_restrictions').execute();
    await tx.deleteFrom('admin_restrictions').execute();
  });
}
