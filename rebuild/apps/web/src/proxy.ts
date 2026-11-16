import { NextResponse, type NextRequest } from 'next/server';
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-umeet-page', request.nextUrl.pathname);
  headers.set('x-umeet-query', request.nextUrl.search);
  return NextResponse.next({request:{headers}});
}
export const config = {matcher:['/((?!api|_next|.*\\..*).*)']};
