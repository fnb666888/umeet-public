import { NextResponse, type NextRequest } from 'next/server';
import { apiUrl } from '../../../../lib/api';

type Context = { params: Promise<{ path: string[] }> };
async function proxy(request: NextRequest, context: Context) {
  const endpoint = (await context.params).path.join('/');
  const id = '[a-zA-Z0-9_-]{1,80}';
  const rules: Record<string, RegExp[]> = {
    GET: [
      /^(account|auth\/channels|auth\/me)$/,
      /^mobile\/(bootstrap|feed|notifications|knowledge-feed)$/,
      new RegExp('^mobile/(posts|profiles)/' + id + '$'),
      new RegExp('^demo/assets/[a-f0-9]{64}$'),
      /^messages(?:\/[a-zA-Z0-9_-]{1,80})?$/,
      /^(governance|community-governance\/(boards|eligibility|applications|moderator-invitations|teams\/mine))$/,
      /^knowledge\/(capabilities|communities|pages|resolve|routes|proposals|drafts)$/,
      new RegExp('^knowledge/(pages|communities|routes|drafts|proposals)/' + id + '$'),
      new RegExp(
        '^knowledge/pages/' + id + '/(history|revision|relations|backlinks|diff|discussions)$',
      ),
    ],
    POST: [
      new RegExp('^mobile/posts/' + id + '/edit$'),
      /^auth\/(login|logout|reauth|wechat\/(mini|link)|otp\/(request|login|register|recovery|link|reauth|password|password-check))$/,
      /^account\/(profile|unlink|revoke|close)$/,
      /^mobile\/(operations|render)$/,
      /^messages\/preferences$/,
      new RegExp('^messages/' + id + '/(send|action)$'),
      /^governance\/(reports|appeals)$/,
      /^community-governance\/(applications|applications\/change|moderator-invitations\/respond|teams\/respond)$/,
      new RegExp(
        '^community-governance/(requests|invitations)/' + id + '/(cancel|accept|decline)$',
      ),
      /^knowledge\/pages$/,
      new RegExp('^knowledge/pages/' + id + '/(submit|discussions|disputes)$'),
    ],
    PUT: [/^knowledge\/drafts$/],
    DELETE: [new RegExp('^knowledge/drafts/' + id + '$')],
  };
  if (!(rules[request.method] ?? []).some((rule) => rule.test(endpoint)))
    return NextResponse.json({ message: 'NOT_FOUND' }, { status: 404 });
  const authorization = request.headers.get('authorization');
  try {
    const response = await fetch(apiUrl('/' + endpoint + request.nextUrl.search), {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Umeet-WeChat-MiniProgram',
        ...(authorization ? { Authorization: authorization } : {}),
        ...(request.headers.get('X-Umeet-Account')
          ? { 'X-Umeet-Account': request.headers.get('X-Umeet-Account')! }
          : {}),
      },
      ...(['POST', 'PUT'].includes(request.method)
        ? { body: JSON.stringify(await request.json()) }
        : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(35000),
    });
    if (endpoint.startsWith('demo/assets/') && response.ok)
      return new NextResponse(await response.arrayBuffer(), {
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'image/png',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ message: 'ACCOUNT_SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;

export const PUT = proxy;
export const DELETE = proxy;
