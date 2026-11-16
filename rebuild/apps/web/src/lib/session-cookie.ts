import type { cookies } from 'next/headers';
import { AuthResultSchema } from '../../../../packages/contracts/src/index';
export function storeSession(
  data: unknown,
  store: Pick<Awaited<ReturnType<typeof cookies>>, 'set'>,
) {
  const result = AuthResultSchema.safeParse(data);
  if (!result.success) return null;
  store.set('umeet_session', result.data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(result.data.expiresAt),
  });
  return result.data.actor;
}
