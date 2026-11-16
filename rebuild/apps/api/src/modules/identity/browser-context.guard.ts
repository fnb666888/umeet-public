import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { DATABASE } from './auth.controller.js';
import { assertBrowserWriteContext } from './browser-session-state.js';
@Injectable()
export class BrowserContextGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx
      .switchToHttp()
      .getRequest<{ method: string; url: string; headers: Record<string, string | undefined> }>();
    if (req.url.startsWith('/api/v1/auth/browser/')) return true;
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['x-umeet-account'] === undefined
    )
      return true;
    const bearer = req.headers.authorization;
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : '';
    if (token)
      await assertBrowserWriteContext(
        this.db,
        token,
        req.headers['x-umeet-account'],
        req.headers['x-umeet-browser-version'],
        req.headers['x-browser-key'],
      );
    return true;
  }
}
