import { ResourceDomain, invalidateResources } from '../../lib/resources';
export const dispositionResources = new ResourceDomain('dispositions', 10000);
export async function dispositionRequest<T>(path = '', body?: unknown): Promise<T> {
  const send = async () => {
    const response = await fetch('/api/backend/governance' + path, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: body === undefined ? {} : {'Content-Type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(
      data.message === 'REPORT_DAILY_LIMIT' ? '今天提交的举报较多，请明天再试'
      : data.message === 'REPORT_REASON_UNAVAILABLE' ? '这个举报理由已调整，请刷新页面后重新选择'
      : response.status === 401 ? '请先登录后查看处置记录' : '操作未完成，请刷新后重试',
    ), {status:response.status});
    return data as T;
  };
  if (body === undefined) return dispositionResources.read(path, send);
  try { return await send(); } finally { invalidateResources(); }
}
