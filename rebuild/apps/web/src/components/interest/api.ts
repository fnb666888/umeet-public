'use client';
import { ResourceDomain, invalidateResources } from '../../lib/resources';
import { useResource } from '../../lib/use-resource';
export const interestResources = new ResourceDomain('interest');
export const cachedInterest = <T,>(path: string) => interestResources.peek<T>(path);
export async function interestApi<T>(path: string, body?: unknown, method = 'POST', signal?: AbortSignal): Promise<T> {
  if (body !== undefined) {
    invalidateResources(undefined, false);
    try { return await sendInterest<T>(path, body, method, signal); }
    finally { invalidateResources(); }
  }
  return interestResources.read(path, () => sendInterest<T>(path), signal);
}

const messages: Record<string, string> = {
  POLL_VERSION_CHANGED: '投票选项已更新，请刷新后重新选择',
  AUTH_REQUIRED: '请先登录',
  REGISTERED_ACCOUNT_REQUIRED: '请使用注册账号',
  POLL_FROZEN: '已有投票或投票已结束，不能更改问题和选项',
  POLL_CLOSED: '投票已结束',
  POLL_EXISTS: '这个帖子已有投票',
  INVALID_POLL_DEADLINE: '截止时间应在未来 90 天内',
  OWNER_REQUIRED: '只有作者可以操作',
  SOURCE_HOST_NOT_ALLOWED: '该来源域名尚未加入服务端白名单',
  SOURCE_APPROVAL_REQUIRED: '请先核实来源及内容展示条件',
  SUPPORTED_OFFICIAL_RELEASE_SOURCE_REQUIRED:
    '当前已接通官方 GitHub 正式版本发布题型，其他领域等待来源接入',
  COMMENT_RATE_LIMIT: '评论较频繁，请稍后再试',
  FORECAST_NOT_DUE: '尚未到核验时间',
  PLATFORM_PERMISSION_REQUIRED: '此操作需要全站管理权限',
  ONLY_PAUSED_DAY_CAN_RETRY: '只有今日已暂停的任务可以重试',
};
async function sendInterest<T>(
  path: string,
  body?: unknown,
  method = 'POST',
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/backend/interest/' + path, {
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  const value = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(
      value.code === 'ACCOUNT_RESTRICTED'
        ? value.message
        : messages[value.message] || '操作未完成，请重试',
    ), {status: response.status});
  }
  return value as T;
}
export function useInterest<T>(path: string | null) {
  const resource = useResource<T>(interestResources, path, (key, signal) => interestApi<T>(key, undefined, 'GET', signal));
  return {...resource, refresh: resource.reload};
}
