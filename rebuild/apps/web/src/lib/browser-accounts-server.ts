import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  AuthResultSchema,
  BrowserAccountStateSchema,
} from '../../../../packages/contracts/src/index';
import { apiUrl } from './api';
import { storeSession } from './session-cookie';

type Store = Awaited<ReturnType<typeof cookies>>;
export class BrowserAccountError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function browserHeaders(request: NextRequest, store: Store): Record<string, string> {
  const account = request.headers.get('x-umeet-account');
  const version = request.headers.get('x-umeet-browser-version');
  const key = store.get('umeet_browser')?.value;
  return {
    ...(account !== null ? { 'X-Umeet-Account': account } : {}),
    ...(version !== null ? { 'X-Umeet-Browser-Version': version } : {}),
    ...(key ? { 'X-Browser-Key': key } : {}),
  };
}
export async function browserCall(store: Store, action: string, body?: object, token?: string) {
  const response = await fetch(apiUrl('/auth/browser/' + action), {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Browser-Key': store.get('umeet_browser')?.value ?? '',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new BrowserAccountError(String(data.message ?? 'ACCOUNT_CHANGE_FAILED'), response.status);
  const state = BrowserAccountStateSchema.parse(data.state);
  if (
    typeof data.deviceToken !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(data.deviceToken) ||
    !Number.isFinite(Date.parse(data.deviceExpiresAt))
  )
    throw new Error('INVALID_BROWSER_REPLY');
  if (data.auth && !storeSession(data.auth, store)) throw new Error('INVALID_AUTH_REPLY');
  if (data.clearSession) store.delete('umeet_session');
  store.set('umeet_browser', data.deviceToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(data.deviceExpiresAt),
  });
  return { state, ...(data.auth ? { actor: AuthResultSchema.parse(data.auth).actor } : {}) };
}
export async function bindBrowserLogin(data: unknown, request: NextRequest, store: Store) {
  const auth = AuthResultSchema.parse(data);
  if (auth.actor.kind !== 'member') {
    storeSession(auth, store);
    return { actor: auth.actor };
  }
  const rawVersion = request.headers.get('x-umeet-browser-version');
  try {
    return await browserCall(
      store,
      'remember',
      { ...(rawVersion !== null ? { version: Number(rawVersion) } : {}) },
      auth.token,
    );
  } catch (error) {
    // A failed addition must leave the previous browser cookie untouched.
    await fetch(apiUrl('/auth/logout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.token },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
    throw error;
  }
}
export function browserFailure(error: unknown) {
  return NextResponse.json(
    {
      message: error instanceof BrowserAccountError ? error.message : '账号服务暂时不可用，请重试',
    },
    { status: error instanceof BrowserAccountError ? error.status : 503 },
  );
}
