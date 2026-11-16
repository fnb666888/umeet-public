import { createHash } from 'node:crypto';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import type { Database } from '../../database/database.types.js';
export const sessionDigest = (token: string) => createHash('sha256').update(token).digest('hex');
type SessionContext = Pick<Selectable<Database['sessions']>, 'browser_anchor' | 'browser_login_id' | 'browser_version' | 'user_id'>;
export async function assertLiveBrowserSession(db: Kysely<Database>, token: string, knownSession?: SessionContext) {
  const row = knownSession ?? await db
    .selectFrom('sessions')
    .select(['browser_anchor', 'browser_login_id', 'browser_version', 'user_id'])
    .where('token_hash', '=', sessionDigest(token))
    .executeTakeFirst();
  if (row?.browser_anchor) throw new UnauthorizedException('AUTH_REQUIRED');
  if (!row?.browser_login_id) return;
  const grant = await db
    .selectFrom('browser_remembered_logins as g')
    .innerJoin('browser_login_sets as s', 's.id', 'g.set_id')
    .innerJoin('sessions as a', 'a.id', 'g.anchor_session_id')
    .select([
      'g.user_id',
      's.current_user_id',
      's.version',
      's.expires_at',
      'a.expires_at as anchorExpires',
      'a.browser_anchor',
    ])
    .where('g.id', '=', row.browser_login_id)
    .executeTakeFirst();
  if (
    !grant ||
    grant.user_id !== row.user_id ||
    grant.current_user_id !== row.user_id ||
    grant.version !== row.browser_version ||
    !grant.browser_anchor ||
    grant.expires_at <= new Date() ||
    grant.anchorExpires <= new Date()
  )
    throw new UnauthorizedException('AUTH_REQUIRED');
}
export async function assertBrowserWriteContext(
  db: Kysely<Database>,
  token: string,
  expectedUser: string | undefined,
  expectedVersion: string | undefined,
  deviceToken: string | undefined,
) {
  const row = await db
    .selectFrom('sessions')
    .select(['browser_anchor', 'browser_login_id', 'browser_version', 'user_id'])
    .where('token_hash', '=', sessionDigest(token))
    .executeTakeFirst();
  if (!row) return; // Individual controllers retain their existing authentication rules.
  if (row.browser_anchor) throw new UnauthorizedException('AUTH_REQUIRED');
  if (row.browser_login_id || expectedUser !== undefined) {
    if (expectedUser !== row.user_id)
      throw new ConflictException({ code: 'ACCOUNT_CHANGED', message: '账号已切换，请刷新后再试' });
    if (row.browser_login_id && expectedVersion !== String(row.browser_version))
      throw new ConflictException({ code: 'ACCOUNT_CHANGED', message: '账号已切换，请刷新后再试' });
  }
  if (expectedVersion !== undefined && deviceToken) {
    const set = await db
      .selectFrom('browser_login_sets')
      .select('version')
      .where('secret_hash', '=', sessionDigest(deviceToken))
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!set || expectedVersion !== String(set.version))
      throw new ConflictException({ code: 'ACCOUNT_CHANGED', message: '账号已切换，请刷新后再试' });
  }
  if (row.browser_login_id) await assertLiveBrowserSession(db, token);
}
export async function revokeAccessSession(db: Kysely<Database>, token: string) {
  const row = await db
    .selectFrom('sessions')
    .select(['browser_login_id'])
    .where('token_hash', '=', sessionDigest(token))
    .executeTakeFirst();
  if (row?.browser_login_id) {
    const grant = await db
      .selectFrom('browser_remembered_logins')
      .select(['anchor_session_id', 'set_id', 'user_id'])
      .where('id', '=', row.browser_login_id)
      .executeTakeFirst();
    if (grant) {
      await db.deleteFrom('sessions').where('id', '=', grant.anchor_session_id).execute();
      await db
        .updateTable('browser_login_sets')
        .set((eb) => ({ current_user_id: null, version: eb('version', '+', 1) }))
        .where('id', '=', grant.set_id)
        .where('current_user_id', '=', grant.user_id)
        .execute();
    }
    await db.deleteFrom('sessions').where('browser_login_id', '=', row.browser_login_id).execute();
  } else await db.deleteFrom('sessions').where('token_hash', '=', sessionDigest(token)).execute();
}
