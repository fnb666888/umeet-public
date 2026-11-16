import { cookies } from 'next/headers';
import { apiUrl } from './api';
import type { AdminList, ModerationAccess } from '../../../../packages/contracts/src/admin';
export type AdminBootstrap = { userId: string; access: ModerationAccess; list: AdminList; path: string };
export async function adminBootstrap(params: Record<string, string | string[] | undefined>): Promise<AdminBootstrap | null> {
  // The default queue is rendered with the document. Other deep links use the
  // same authorized bootstrap in the client, retaining their exact filters.
  if (params.view || params.board || params.record) return null;
  const store = await cookies(), token = store.get('umeet_session')?.value;
  if (!token) return null;
  const query = new URLSearchParams({ section: 'reports', q: '', status: 'pending', kind: 'all', page: '1' });
  try {
    const response = await fetch(apiUrl('/admin/community/bootstrap?' + query), {
      headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return { ...await response.json(), path: 'items?' + query };
  } catch { return null; }
}
