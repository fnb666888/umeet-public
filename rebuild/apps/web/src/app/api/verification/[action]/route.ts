import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { apiUrl } from '../../../../lib/api';
import { allowedRequestOrigin } from '../../../../lib/request-origin';
import { bindBrowserLogin, browserFailure, browserHeaders } from '../../../../lib/browser-accounts-server';
import { OtpChallengeSchema } from '../../../../../../../packages/contracts/src/index';
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!['request', 'login', 'link', 'reauth', 'recovery', 'register', 'password', 'password-check'].includes(action))
    return NextResponse.json({ message: '不存在' }, { status: 404 });
  if (!allowedRequestOrigin(request.headers.get('origin')))
    return NextResponse.json({ message: '请求来源不匹配' }, { status: 403 });
  const store = await cookies(),
    token = store.get('umeet_session')?.value;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: '请求内容格式有误' }, { status: 400 });
  }
  try {
    const upstream = await fetch(apiUrl('/auth/otp/' + action), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...browserHeaders(request, store),
        'User-Agent': request.headers.get('user-agent') || 'Umeet-Web',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(35000),
    });
    const data: unknown = await upstream.json();
    if (!upstream.ok) {
      const delay =
        data &&
        typeof data === 'object' &&
        'retryAfterSeconds' in data &&
        typeof data.retryAfterSeconds === 'number' &&
        Number.isInteger(data.retryAfterSeconds) &&
        data.retryAfterSeconds > 0 &&
        data.retryAfterSeconds <= 60
          ? data.retryAfterSeconds
          : null;
      return NextResponse.json(
        {
          message:
            data && typeof data === 'object' && 'message' in data
              ? String(data.message)
              : '验证未完成',
          ...(delay ? { retryAfterSeconds: delay } : {}),
        },
        { status: upstream.status, headers: delay ? { 'Retry-After': String(delay) } : {} },
      );
    }
    if (['login', 'recovery', 'register', 'password'].includes(action)) {
      return NextResponse.json(await bindBrowserLogin(data, request, store));
    }
    if (action === 'request') {
      const parsed = OtpChallengeSchema.safeParse(data);
      return parsed.success
        ? NextResponse.json(parsed.data)
        : NextResponse.json({ message: '验证码服务响应无效' }, { status: 502 });
    }
    if (action === 'reauth' || action === 'password-check') {
      if (!data || typeof data !== 'object' || !('ok' in data) || data.ok !== true) return NextResponse.json({ message: '验证响应无效' }, { status: 502 });
      return NextResponse.json({ ok: true });
    }
    if(!data||typeof data!=='object'||!('linked'in data)||data.linked!==true)return NextResponse.json({message:'绑定服务响应无效'},{status:502});
    return NextResponse.json({ linked: true });
  } catch (error) {
    return browserFailure(error);
  }
}
