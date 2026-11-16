import { apiBase } from '../config';
import { session, epoch, clearSession, requireLogin, uuid } from './session';
const messages: Record<string, string> = {
  AUTH_REQUIRED: '登录已过期，请重新登录',
  INVALID_CREDENTIALS: '用户名、邮箱或密码错误',
  LOGIN_CHANNEL_UNAVAILABLE: '此登录方式尚未启用',
  OTP_INVALID_OR_EXPIRED: '验证码错误或已过期',
  INVALID_INPUT: '请检查填写内容',
  TOO_MANY_ATTEMPTS: '操作频繁，请稍后重试',
  REVISION_CONFLICT: '正文已更新，请核对最新版本后重提',
  DRAFT_CONFLICT: '草稿有新版本，请比较或另存当前内容',
  KNOWLEDGE_UNAVAILABLE: '词条已隐藏或暂不可用',
  BOARD_READ_ONLY: '此板块暂时停止发帖',
  FIRST_POST_ALREADY_PENDING: '已有首帖等待审核',
  REAUTHENTICATION_REQUIRED: '请先重新验证当前账号',
  CONTENT_UNAVAILABLE: '内容已隐藏或暂不可用',
  IDENTITY_ACCOUNT_CONFLICT: '此微信或邮箱已关联其他账号',
  FORMULA_INVALID: '公式格式有误，请检查 LaTeX',
  NOT_FOUND: '此功能暂不可用，请稍后重试',
};
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method: WechatMiniprogram.RequestOption['method'] = 'GET',
  data?: any,
  headers: Record<string, string> = {},
): Promise<T> {
  const owner = session(),
    version = epoch();
  return new Promise((resolve, reject) =>
    wx.request({
      url: apiBase() + '/' + path.replace(/^\//, ''),
      method,
      data,
      timeout: 40000,
      header: {
        'Content-Type': 'application/json',
        ...(owner
          ? { Authorization: 'Bearer ' + owner.token, 'X-Umeet-Account': owner.actor.userId }
          : {}),
        ...headers,
      },
      success(res) {
        if (version !== epoch() || owner?.actor.userId !== session()?.actor.userId) {
          reject(new Error('账号已变化，已忽略旧页面响应'));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
          return;
        }
        const body = res.data as any;
        const code = body?.code || body?.message || 'REQUEST_FAILED';
        if (res.statusCode === 401 && owner?.token === session()?.token) {
          clearSession();
          wx.reLaunch({ url: '/features/account/index' });
        }
        reject(
          new ApiError(
            code,
            res.statusCode,
            messages[code] ||
              (typeof body?.message === 'string' && !/^[A-Z_]+$/.test(body.message)
                ? body.message
                : '操作未完成，输入内容已保留'),
          ),
        );
      },
      fail(error) {
        reject(
          new Error(
            error.errMsg.includes('domain')
              ? '开发环境的请求域名校验尚未配置'
              : '网络连接失败，输入内容已保留，请重试',
          ),
        );
      },
    }),
  );
}
export function showError(error: any, _detailed = false) {
  wx.showToast({ title: error.message || '操作失败', icon: 'none', duration: 3000 });
}
export const showToast = (title: string) => wx.showToast({ title, icon: 'none' });
export const isLogged = () => !!session();
export const requestKey = uuid;
export const schoolId = () => '';
export const ensureMember = async (_school?: string) => requireLogin();
export const labels: Record<string, string> = {};
export function formatDate(value: string | number) {
  const d = new Date(value);
  return (
    d.getMonth() +
    1 +
    '月' +
    d.getDate() +
    '日 ' +
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0')
  );
}
export function displayPost(p: any) {
  return {
    ...p,
    time: formatDate(p.createdAt),
    initial: (p.author || 'U').slice(0, 1),
    likes: p.likes || 0,
  };
}
export function assetURL(url: string) {
  return url.startsWith('/api/backend/demo/assets/')
    ? apiBase() + '/demo/assets/' + url.split('/').pop()
    : url;
}
export async function upload(path: string, _purpose?: string): Promise<any> {
  const r = await new Promise<any>((resolve, reject) =>
    wx
      .getFileSystemManager()
      .readFile({ filePath: path, encoding: 'base64', success: resolve, fail: reject }),
  );
  return { id: 'data:image/' + (/\.png$/i.test(path) ? 'png' : 'jpeg') + ';base64,' + r.data };
}
export const asset = async (id: string) => assetURL(id);
export async function operate(operations: any[], id = uuid()) {
  return api('mobile/operations', 'POST', { id, operations });
}
export async function bootstrap() {
  return api('mobile/bootstrap');
}
function formulaName(source: string) {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < source.length; i++) {
    a = Math.imul(a ^ source.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ source.charCodeAt(i);
  }
  return (
    'formula-' +
    (a >>> 0).toString(16).padStart(8, '0') +
    (b >>> 0).toString(16).padStart(8, '0') +
    '.png'
  );
}
export async function render(markdown: string, html?: string) {
  const choice = wx.getStorageSync('umeet:theme') || 'system',
    dark = choice === 'dark' || (choice === 'system' && wx.getAppBaseInfo().theme === 'dark');
  const result = await api('mobile/render', 'POST', { markdown, ...(html ? { html } : {}), dark });
  const fs = wx.getFileSystemManager(),
    dir = wx.env.USER_DATA_PATH + '/umeet-formulas-' + (session()?.actor.userId ?? 'public');
  try {
    fs.mkdirSync(dir, true);
  } catch {}
  const used = new Set<string>();
  const visit = async (nodes: any[]) => {
    for (const node of nodes) {
      if (node.name === 'img' && node.attrs?.src?.startsWith('data:image/png;base64,')) {
        const src = node.attrs.src,
          name = formulaName(src),
          file = dir + '/' + name;
        used.add(name);
        let exists = false;
        try {
          fs.accessSync(file);
          exists = true;
        } catch {}
        if (!exists)
          await new Promise<void>((resolve, reject) =>
            fs.writeFile({
              filePath: file,
              data: src.slice(src.indexOf(',') + 1),
              encoding: 'base64',
              success: () => resolve(),
              fail: reject,
            }),
          );
        node.attrs.src = file;
      } else if (node.name === 'img') node.attrs.src = assetURL(node.attrs.src);
      if (node.children) await visit(node.children);
    }
  };
  for (const block of result.blocks) await visit(block.nodes);
  try {
    const files = fs.readdirSync(dir).filter((n) => /^formula-[a-f0-9]{16}\.png$/.test(n));
    const unused = files.filter((n) => !used.has(n));
    for (const name of unused.slice(0, Math.max(0, files.length - 120)))
      fs.unlinkSync(dir + '/' + name);
  } catch {}
  return result;
}
export async function openContent(url: string) {
  if (url.startsWith('wiki:')) {
    const r = await api(
      'knowledge/resolve?title=' + encodeURIComponent(decodeURIComponent(url.slice(5))),
    );
    if (r?.pageIds?.length === 1)
      wx.navigateTo({ url: '/features/knowledge-detail/index?id=' + r.pageIds[0] });
    else if (r?.pageIds?.length) {
      const pages = await Promise.all(
        r.pageIds.slice(0, 6).map((id: string) => api('knowledge/pages/' + id)),
      );
      const choice = await wx.showActionSheet({ itemList: pages.map((p: any) => p.title) });
      wx.navigateTo({ url: '/features/knowledge-detail/index?id=' + pages[choice.tapIndex].id });
    } else showToast('未找到关联词条');
  } else if (url.startsWith('/knowledge/'))
    wx.navigateTo({ url: '/features/knowledge-detail/index?id=' + url.split('/')[2] });
  else if (url.startsWith('https://')) {
    wx.setClipboardData({ data: url });
  }
}
