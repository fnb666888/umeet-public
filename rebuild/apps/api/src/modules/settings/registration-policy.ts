import { ForbiddenException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type { SiteSettings } from '../../../../../packages/contracts/src/site-settings.js';
import { requireScope } from '../admin/scope.js';
import { requireCapability } from '../admin/restrictions.js';
import { SettingsService } from './settings.service.js';

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

export function requireCampusEmail(policy: SiteSettings['registration'], email: string) {
  if (policy.mode === 'campus' && !policy.domains.includes(email.slice(email.lastIndexOf('@') + 1)))
    throw new ForbiddenException('CAMPUS_EMAIL_REQUIRED');
}

export async function consumeRegistrationInvite(tx: Transaction<Database>, code?: string) {
  if (!code) throw new ForbiddenException('REGISTRATION_INVITE_REQUIRED');
  const now = new Date();
  const result = await tx
    .updateTable('registration_invites')
    .set({ used_at: now })
    .where('code_hash', '=', hashCode(code))
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst();
  if (!result.numUpdatedRows) throw new ForbiddenException('REGISTRATION_INVITE_INVALID');
}

export async function issueRegistrationInvite(db: Kysely<Database>, actorId: string) {
  return db.transaction().execute(async (tx) => {
    await requireScope(tx, actorId);
    await requireCapability(tx, actorId, 'suspension');
    const { settings } = await new SettingsService(tx).getSiteSettings();
    if (settings.registration.mode !== 'invite')
      throw new ForbiddenException('REGISTRATION_INVITES_DISABLED');
    const code = randomBytes(16).toString('hex');
    const created = new Date();
    const expiresAt = new Date(created.getTime() + 7 * 86400000);
    await tx
      .insertInto('registration_invites')
      .values({
        code_hash: hashCode(code),
        expires_at: expiresAt,
        used_at: null,
      })
      .execute();
    await tx
      .insertInto('admin_actions')
      .values({
        id: randomUUID(),
        actor_id: actorId,
        action: 'settings.invite',
        target: 'site-settings',
        request_hash: '',
        reason: '生成单次注册邀请码',
        before_data: 'null',
        after_data: 'null',
        created_at: created,
      })
      .execute();
    return { code, expiresAt: expiresAt.toISOString() };
  });
}

export async function initializeAnnouncements(tx: Transaction<Database>, userId: string) {
  const { settings } = await new SettingsService(tx).getSiteSettings();
  if (!settings.notifications.announcements) return;
  const row = await tx
    .selectFrom('demo_user_states')
    .select('data')
    .where('user_id', '=', userId)
    .forUpdate()
    .executeTakeFirst();
  const state = row ? JSON.parse(row.data) : {};
  if (state.notifPrefs) return;
  const data = JSON.stringify({
    ...state,
    notifPrefs: { reply: true, like: true, follow: true, system: true },
  });
  const updated_at = new Date();
  await tx
    .insertInto('demo_user_states')
    .values({ user_id: userId, data, updated_at })
    .onDuplicateKeyUpdate({ data, updated_at })
    .execute();
}
