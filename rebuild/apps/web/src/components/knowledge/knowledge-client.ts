import { ResourceDomain, invalidateResources } from '../../lib/resources';
export const knowledgeResources = new ResourceDomain('knowledge');
const cacheable = (path: string) => /^(?:pages(?:\/[^/?]+(?:\/(?:relations|backlinks))?)?|routes(?:\/[^/?]+)?|communities(?:\/[^/?]+)?)(?:\?|$)/.test(path);
export function cachedKnowledgeRead<T>(path: string) { return cacheable(path) ? knowledgeResources.peek<T>(path) : undefined; }
export function forgetKnowledgeRead(path: string) { knowledgeResources.forget(path); }
export function readKnowledge<T>(path: string, signal?: AbortSignal): Promise<T> {
  return knowledgeResources.read(path, () => knowledge<T>(path), signal, cacheable(path));
}
export async function prefetchKnowledgeHref(href: string) {
  if (typeof location === 'undefined') return;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return;
  const path = url.pathname === '/knowledge' ? 'pages?q=' + encodeURIComponent(url.searchParams.get('q') || '')
    : /^\/c\/[^/]+\/knowledge$/.test(url.pathname) ? 'communities/' + url.pathname.split('/')[2]
    : /^\/knowledge\/routes\/[^/]+$/.test(url.pathname) ? 'routes/' + url.pathname.split('/').pop()
    : /^\/knowledge\/[^/]+$/.test(url.pathname) && !/\/(?:new|manage)$/.test(url.pathname) ? 'pages/' + url.pathname.split('/').pop() : '';
  if (path) {
    await readKnowledge(path);
    if (url.pathname === '/knowledge') await Promise.all([readKnowledge('routes'), readKnowledge('communities')]);
  }
}
import type { KnowledgeCapabilities } from '../../../../../packages/contracts/src/knowledge';
export class KnowledgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly latestRevisionId: string | null = null,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  ACCOUNT_CHANGED: '账号已变化，请重新打开编辑页面。原账号已保存的私人草稿会保留。',
  AUTH_REQUIRED: '请先登录后继续。',
  REGISTERED_ACCOUNT_REQUIRED: '请使用注册账号参与编辑。',
  REVISION_CONFLICT: '词条已有新版本，请对照差异后重新提交。',
  DRAFT_CONFLICT: '另一设备已保存较新的草稿，请先比较或另存当前稿。',
  PUBLICATION_PAUSED: '此词条正在复核，仍可提交修改建议。',
  WIKI_MANAGEMENT_REQUIRED: '你目前没有 Wiki 正文管理权限。',
  COMMUNITY_WIKI_MANAGEMENT_REQUIRED: '你目前没有这个社区的 Wiki 组织权限。',
  ORGANIZATION_CONFLICT: '目录或路线已有更新，请重新加载后调整。',
  KNOWLEDGE_UNAVAILABLE: '词条尚未发布、已隐藏或已清除。',
  PREREQUISITE_CYCLE: '这些前置知识形成了循环，请调整关系。',
  RELATION_TARGET_UNAVAILABLE: '关联词条不可用，请重新选择。',
  REASON_REQUIRED: '请填写处理理由。',
  INVALID_INPUT: '请检查填写内容，标题和正文不能为空。',
  IDEMPOTENCY_CONFLICT: '本次请求内容已变化，请重新提交。',
};
export async function knowledge<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal; accountId?: string } = {},
): Promise<T> {
  const write = !['GET', 'HEAD'].includes(options.method ?? 'GET');
  if (write) invalidateResources(undefined, false);
  try {
  const response = await fetch('/api/backend/knowledge/' + path, {
    method: options.method ?? 'GET',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(options.accountId ? { 'X-Knowledge-Account': options.accountId } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const data = value && typeof value === 'object' ? value : {};
    const code =
      'code' in data && typeof data.code === 'string'
        ? data.code
        : 'message' in data && typeof data.message === 'string'
          ? data.message
          : 'REQUEST_FAILED';
    const latest =
      'latestRevisionId' in data && typeof data.latestRevisionId === 'string'
        ? data.latestRevisionId
        : null;
    throw new KnowledgeError(
      messages[code] ??
        (response.status === 403
          ? '当前账号没有此操作权限。'
          : response.status === 401
            ? '请先登录后继续。'
            : '操作未完成，请稍后重试。'),
      code,
      response.status,
      latest,
    );
  }
  return value as T;
  } finally { if (write) invalidateResources(); }
}
export const emptyCapabilities: KnowledgeCapabilities = {
  accountId: null,
  canContribute: false,
  canGovernBody: false,
  canOrganizeCommunity: false,
  isSiteAdmin: false,
};
export function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请重试。';
}
