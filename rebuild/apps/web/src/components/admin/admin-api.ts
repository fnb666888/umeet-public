import { ResourceDomain, invalidateResources } from '../../lib/resources';
import { accountState, refreshAccountContext } from '../../lib/browser-session';
import type { AdminList, ModerationAccess } from '../../../../../packages/contracts/src/admin';
export const adminResources = new ResourceDomain('admin');
export function invalidateAdminReads() { adminResources.invalidate(); }
export function cachedAdminRead<T>(path: string) { return adminResources.peek<T>(path); }
export async function initialAdminRead(params: URLSearchParams, signal?: AbortSignal) {
  const existing = cachedAdminRead<ModerationAccess>('access');
  if (existing) return adminRequest<ModerationAccess>('access', undefined, signal);
  const section = params.get('view') || 'reports';
  if (!['reports', 'content', 'users', 'wiki', 'history', 'team', 'appeals', 'reviews', 'trash'].includes(section) || section === 'team')
    return adminRequest<ModerationAccess>('access', undefined, signal);
  await refreshAccountContext();
  const query = new URLSearchParams({ section,
    ...(params.get('record') ? { record: params.get('record')! } : { q: '', status: ['reports', 'appeals', 'reviews'].includes(section) ? 'pending' : 'all', kind: 'all', page: '1' }),
    ...(params.get('board') ? { board: params.get('board')! } : {}),
  });
  const identity = () => { const state = accountState(); return JSON.stringify([state?.deviceId, state?.version, state?.currentUserId]); };
  const scope = identity();
  const result = await adminRequest<{access: ModerationAccess; list: AdminList}>('bootstrap?' + query, undefined, signal);
  if (scope !== identity()) throw new Error('账号状态已变化，请刷新后重试');
  adminResources.seed('access', result.access);
  adminResources.seed('items?' + query, result.list);
  return result.access;
}
export async function adminRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (body !== undefined) {
    invalidateResources(undefined, false);
    try { return await sendAdminRequest<T>(path, body, signal); }
    finally { invalidateResources(); }
  }
  return adminResources.read(path, () => sendAdminRequest<T>(path), signal);
}
async function sendAdminRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const response = await fetch('/api/backend/admin/community/' + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) throw Object.assign(new Error('请先登录管理员账号'), {status: response.status});
    const messages: Record<string, string> = {
      SITE_OWNER_REQUIRED: '此项操作仅限超级管理员',
      BOARD_MODERATOR_EXISTS: '该板块已有版主，每个板块只能分配一名版主',
      MODERATOR_BOARDS_REQUIRED: '请为受邀版主选择负责的社区',
      MODERATOR_INVITATION_REQUIRED: '请通过邀请版主添加成员',
      SITE_OWNER_PROTECTED: '请通过转让站点交接超级管理员身份',
      ALREADY_SITE_OWNER: '请选择其他用户作为新超级管理员',
      USER_SUSPENDED: '请先解除目标用户的全站封禁',
      BUILTIN_GROUP_FIXED: '默认群组固定保留',
      USE_GROUP_MANAGEMENT: '请在群组管理中调整成员权限',
      INDEPENDENT_REVIEWER_REQUIRED: '请由另一位有复核权限的管理人员处理',
      NEWER_DISPOSITION_EXISTS: '该对象已有后续管理变更，请先核对最新状态',
      APPEAL_ALREADY_REVIEWED: '这项申诉已复核，请刷新查看结果',
      CURRENT_REVISION_CANNOT_HIDE: '请先恢复到安全版本，再隐藏这一修订',
      WIKI_TITLE_EXISTS: '该词条标题已被使用',
      REPORT_ALREADY_RESOLVED: '这条举报已被处理，请刷新查看结果',
      WIKI_REVISION_CONFLICT: 'Wiki 已有新版本，请刷新后重新比较',
      ADMIN_ACCOUNT_PROTECTED: '管理员账号受保护，无法执行此项账号处置',
      PLATFORM_SCOPE_REQUIRED: '此项操作需要在全站管理中执行',
      CONTENT_MOVED_TO_OTHER_COMMUNITY: '内容已移至其他社区，请核对当前管理范围',
      PENALTY_ALREADY_REVOKED: '这项处置已经解除，请刷新查看结果',
      INVALID_WIKI_REVISION: '请选择有效的历史版本',
      DISPOSITION_VERSION_CONFLICT: '该用户的限制已变更，请返回列表刷新后重试',
      INVALID_APPEAL_DECISIONS: '请为每项处置选择复核结果',
      IDEMPOTENCY_CONFLICT: '请求内容已改变，请刷新后重试',
      LAST_COMMUNITY_OWNER: '请先添加另一位社区主，再调整当前社区主',
      SHARED_WIKI_PERMISSION_REQUIRED: '该词条关联多个社区，需要全部关联社区的管理权限',
      COMMUNITY_SCOPE_REQUIRED: '请先选择社区',
      GROUP_NAME_EXISTS: '已有同名群组',
      GROUP_MEMBER_NOT_FOUND: '有用户名不存在或账号已注销，请核对后重试',
      GROUP_NOT_FOUND: '找不到该群组，请刷新后重试',
      GROUP_MEMBERS_CHANGED: '群组成员已变更，请重新打开群组后再保存',
      GROUP_MEMBER_LIMIT: '此群组已达到 200 名成员上限',
      SETTINGS_VERSION_CONFLICT: '设置已被其他管理员修改。请重新加载后再保存。',
      REGISTRATION_INVITES_DISABLED: '请先保存仅限邀请的注册模式。',
      POST_REVIEW_ALREADY_DECIDED: '该首帖已处理，请返回队列刷新。',
      POST_REVIEW_AUTHOR_UNAVAILABLE: '作者账号已不可用，可以选择不予发布。',
    };
    if (data.message === 'INVALID_SITE_SETTINGS') {
      const issue = data.issues?.[0];
      const sections: Record<string, string> = {
        site: '站点信息', boards: '板块规则', announcements: '公告', reportReasons: '举报理由',
        registration: '注册与通知', notifications: '注册与通知',
      };
      const area = sections[issue?.path?.[1]];
      throw new Error(area ? '请核对「' + area + '」。' + issue.message : '请核对设置后重试。');
    }
    throw Object.assign(new Error(
      data.eligibility?.blockReasons?.join('，') ||
      messages[data.message] ||
        (response.status === 403 ? '当前账号没有管理权限' : '操作未完成，请刷新后重试'),
    ), {status: response.status});
  }
  return data as T;
}
