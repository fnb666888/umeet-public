import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './support/test-app.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
import { changeGroupMembers, assignModeratorBoards } from '../src/modules/admin/groups.js';
import {
  respondModeratorInvitation,
  withdrawModeratorInvitation,
} from '../src/modules/admin/moderator-invitations.js';
import { moderationAccess } from '../src/modules/admin/scope.js';
import { moderatorGroupId } from '../../../packages/contracts/src/admin.js';

it('grants moderator access only after acceptance and handles stale, competing and withdrawn invitations', async () => {
  const h = await createTestApp();
  try {
    const identity = new IdentityService(h.db);
    const [admin, first, second] = await Promise.all(
      ['admin', 'first', 'second'].map((subject) =>
        identity.resolve({ provider: 'test', subject, kind: 'member' }),
      ),
    );
    await h.db
      .insertInto('platform_roles')
      .values({ user_id: admin!.userId, role: 'admin' })
      .execute();
    await h.db
      .insertInto('runtime_settings')
      .values({
        id: 'community-application-policy',
        value: '{"days":0,"posts":0}',
        revision: 1,
        updated_at: new Date(),
      })
      .execute();
    const invite = (userId: string, boards: string[]) =>
      changeGroupMembers(h.db, admin!.userId, {
        groupId: moderatorGroupId,
        userIds: [userId],
        member: true,
        boards,
      });
    await invite(first!.userId, ['daily']);
    await invite(first!.userId, ['daily']);
    expect((await moderationAccess(h.db, first!.userId)).boards).toEqual([]);
    const rows = await h.db
      .selectFrom('community_requests')
      .selectAll()
      .where('kind', '=', 'moderator_invitation')
      .execute();
    expect(rows).toHaveLength(1);
    const input = { id: rows[0]!.id, version: 1, action: 'accept' as const };
    await expect(respondModeratorInvitation(h.db, second!.userId, input)).rejects.toThrow(
      'INVITATION_NOT_YOURS',
    );
    await h.db
      .updateTable('runtime_settings')
      .set({ value: '{"days":30,"posts":5}' })
      .where('id', '=', 'community-application-policy')
      .execute();
    await expect(respondModeratorInvitation(h.db, first!.userId, input)).rejects.toThrow();
    await h.db
      .updateTable('runtime_settings')
      .set({ value: '{"days":0,"posts":0}' })
      .where('id', '=', 'community-application-policy')
      .execute();
    await invite(second!.userId, ['daily']);
    const rival = await h.db
      .selectFrom('community_requests')
      .selectAll()
      .where('user_id', '=', second!.userId)
      .executeTakeFirstOrThrow();
    const results = await Promise.allSettled([
      respondModeratorInvitation(h.db, first!.userId, input),
      respondModeratorInvitation(h.db, second!.userId, {
        id: rival.id,
        version: 1,
        action: 'accept',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = results[0]!.status === 'fulfilled' ? first! : second!;
    const winning =
      winner === first ? input : { id: rival.id, version: 1, action: 'accept' as const };
    await expect(respondModeratorInvitation(h.db, winner.userId, winning)).resolves.toEqual({
      version: 2,
    });
    await assignModeratorBoards(h.db, admin!.userId, [winner.userId], ['daily', 'market']);
    expect(
      (await moderationAccess(h.db, winner.userId)).boards.map((board) => board.board),
    ).toEqual(['daily']);
    const market = await h.db
      .selectFrom('community_requests')
      .selectAll()
      .where('user_id', '=', winner.userId)
      .where('board', '=', 'market')
      .executeTakeFirstOrThrow();
    await withdrawModeratorInvitation(h.db, admin!.userId, market.id);
    await expect(
      respondModeratorInvitation(h.db, winner.userId, {
        id: market.id,
        version: 1,
        action: 'accept',
      }),
    ).rejects.toThrow('INVITATION_NOT_PENDING');
    await invite(winner.userId, ['market']);
    const pending = await h.db
      .selectFrom('community_requests')
      .selectAll()
      .where('user_id', '=', winner.userId)
      .where('board', '=', 'market')
      .where('state', '=', 'pending')
      .executeTakeFirstOrThrow();
    await respondModeratorInvitation(h.db, winner.userId, {
      id: pending.id,
      version: 1,
      action: 'decline',
    });
    expect(
      (await moderationAccess(h.db, winner.userId)).boards.map((board) => board.board),
    ).toEqual(['daily']);
  } finally {
    await h.close();
  }
});
