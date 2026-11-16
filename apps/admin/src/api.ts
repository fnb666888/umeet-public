export const labels: Record<string, string> = {
  GENERAL: '校园日常',
  HELP: '打听求助',
  MARKET: '闲置集市',
  LOST: '失物招领',
  TREEHOLE: '匿名树洞',
  GUIDE: '校园指南',
  PENDING: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '未通过',
  HIDDEN: '已隐藏',
  DRAFT: '草稿',
  ACTIVE: '进行中',
  SOLD: '已出',
  FOUND: '已找回',
  SOLVED: '已解决',
  CLOSED: '已结束',
  VERIFIED: '已认证',
  APPROVED: '已通过',
  UNVERIFIED: '未认证',
  EXPIRED: '已过期',
  PROCESSING: '处理中',
  FAILED: '失败',
  DONE: '完成',
};
export const date = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
export function client(key: string) {
  return async (
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const token = sessionStorage.getItem(key);
    const result = await fetch('/api/v1' + path, {
      method,
      headers: {
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const data = await result.json().catch(() => ({ message: '服务响应异常' }));
    if (!result.ok) {
      if (result.status === 401) sessionStorage.removeItem(key);
      throw new Error(
        Array.isArray(data.message) ? data.message.join('；') : data.message || '请求失败',
      );
    }
    return data;
  };
}
export async function imageUrl(id: string, key: string) {
  const response = await fetch('/api/v1/media/' + id, {
    headers: { Authorization: 'Bearer ' + sessionStorage.getItem(key) },
  });
  if (!response.ok) throw new Error('图片暂不可查看');
  return URL.createObjectURL(await response.blob());
}
