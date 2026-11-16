import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { apiUrl } from '../../../../lib/api';
import { allowedRequestOrigin } from '../../../../lib/request-origin';
import { bindBrowserLogin, browserCall, browserFailure, browserHeaders } from '../../../../lib/browser-accounts-server';
type Context = { params: Promise<{ action: string }> };
export async function POST(request: NextRequest, context: Context) {
  const { action } = await context.params;
  if (!['guest', 'register', 'login', 'logout', 'password', 'reauth', 'switch', 'remove', 'logout-all', 'remember'].includes(action))
    return NextResponse.json({ message: '不支持的操作' }, { status: 404 });
  const origin = request.headers.get('origin');
  if (!allowedRequestOrigin(origin))
    return NextResponse.json({ message: '请求来源不匹配' }, { status: 403 });
  const store = await cookies();
  const session = store.get('umeet_session')?.value;
  try {
    const body: unknown = await request.json();
    if (['switch', 'remove', 'logout-all', 'remember'].includes(action)) return NextResponse.json(await browserCall(store, action, body as object, session), { headers: { 'Cache-Control': 'private, no-store' } });
    const upstream = await fetch(apiUrl('/auth/' + action), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...browserHeaders(request, store),
        'User-Agent': request.headers.get('user-agent') || 'Umeet-Web',
        ...(session ? { Authorization: 'Bearer ' + session } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const data: unknown = await upstream.json();
    if (!upstream.ok)
      return NextResponse.json(
        {
          message:
            data && typeof data === 'object' && 'message' in data
              ? String(data.message)
              : '认证未完成',
        },
        { status: upstream.status },
      );
    if (action === 'reauth') return NextResponse.json({ ok: true });
    if (action === 'logout') {
      store.delete('umeet_session');
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(await bindBrowserLogin(data, request, store));
  } catch (error) {
    return browserFailure(error);
  }
}
export async function GET(request: NextRequest, context: Context) {
  const { action } = await context.params;
  if (action === 'accounts' || action === 'context') {
    const store = await cookies();
    try { return NextResponse.json(await browserCall(store, action, undefined, store.get('umeet_session')?.value), { headers: { 'Cache-Control': 'private, no-store' } }); } catch (error) { return browserFailure(error); }
  }
  if (!['me', 'methods', 'channels'].includes(action))
    return NextResponse.json({ message: '不存在' }, { status: 404 });
  const store = await cookies();
  const token = store.get('umeet_session')?.value;
  if (!token && action !== 'channels')
    return NextResponse.json({ message: '未登录' }, { status: 401 });
  try {
    const response = await fetch(apiUrl('/auth/' + action), {
      headers: { ...browserHeaders(request, store), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const data: unknown = await response.json();
    return NextResponse.json(data, {
      status: response.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ message: '认证服务暂时不可用' }, { status: 503 });
  }
}
