import { cookies } from 'next/headers';
import { apiUrl } from './api';

export async function discussionApi<T>(path: string, withSession = false) {
  const token = withSession ? (await cookies()).get('umeet_session')?.value : undefined;
  const response = await fetch(apiUrl('/discussions' + path), {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: response.ok ? ((await response.json()) as T) : null };
}
