import type { Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../database/database.types.js';
import { baseModerationAccess } from './scope.js';
import { permits, type ModerationPermission } from '../../../../../packages/contracts/src/admin.js';

export async function syncCommunityTeams(tx: Transaction<Database>) {
  const teams = await tx.selectFrom('community_teams').selectAll().forUpdate().execute();
  for (const team of teams) {
    const owner = await baseModerationAccess(tx, team.owner_id);
    const grant = owner.boards.find(
      (entry) => entry.board === team.board && entry.role === 'moderator',
    );
    if (!grant || !permits(grant.permissions, 'teams.manage')) {
      if (team.state !== 'suspended')
        await tx
          .updateTable('community_teams')
          .set({ state: 'suspended', version: team.version + 1 })
          .where('id', '=', team.id)
          .execute();
      continue;
    }
    const members = await tx
      .selectFrom('community_team_members')
      .selectAll()
      .where('team_id', '=', team.id)
      .execute();
    let changed = false;
    for (const member of members) {
      const before = JSON.parse(member.permissions) as ModerationPermission[];
      const after = before.filter((permission) => permits(grant.permissions, permission));
      if (after.length !== before.length) {
        changed = true;
        await tx
          .updateTable('community_team_members')
          .set({ permissions: JSON.stringify(after), version: member.version + 1 })
          .where('team_id', '=', team.id)
          .where('user_id', '=', member.user_id)
          .execute();
        await tx
          .insertInto('admin_notifications')
          .values({
            id: randomUUID(),
            user_id: member.user_id,
            text: '管理团队权限已调整',
            detail: team.name + ' 的创建者权限发生变化，相关授权已同步收回。',
            href: '/#/my-applications',
            created_at: new Date(),
          })
          .execute();
        await tx
          .insertInto('admin_actions')
          .values({
            id: randomUUID(),
            actor_id: team.owner_id,
            target: member.user_id,
            board: team.board,
            action: 'team.permissions.sync',
            request_hash: '',
            reason: '同步创建者权限上限',
            before_data: JSON.stringify(before),
            after_data: JSON.stringify(after),
            created_at: new Date(),
          })
          .execute();
      }
    }
    if (changed)
      await tx
        .updateTable('community_teams')
        .set({ version: team.version + 1 })
        .where('id', '=', team.id)
        .execute();
  }
}
