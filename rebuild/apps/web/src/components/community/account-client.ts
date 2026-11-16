import { humanVerification } from '../../lib/turnstile-client';
import { ResourceDomain, invalidateResources } from '../../lib/resources';
export const accountResources = new ResourceDomain('account', 10000);
const messages: Record<string, string> = {
  HUMAN_VERIFICATION_REQUIRED: '请先完成人机验证',
  HUMAN_VERIFICATION_FAILED: '人机验证已失效，请重试',
  HUMAN_VERIFICATION_UNAVAILABLE: '人机验证服务暂不可用，请稍后重试',
  BROWSER_ACCOUNT_LIMIT: '最多记住 5 个账号，请先移除一个账号',
  BROWSER_CONTEXT_CHANGED: '其他标签页已切换账号，请刷新页面后重试',
  BROWSER_DEVICE_EXPIRED: '此浏览器的账号记录已过期，请刷新并重新登录',
  BROWSER_LOGIN_EXPIRED: '登录已过期，请选择此账号重新登录',
  BROWSER_ACCOUNT_BLOCKED: '此账号暂不可用，请联系管理人员',
  BROWSER_ACCOUNT_NOT_SAVED: '此账号不在当前浏览器的账号列表中',
  CURRENT_PASSWORD_INVALID: '原密码错误，请重新输入',
  CURRENT_PASSWORD_REQUIRED: '请输入原密码',
  ACCOUNT_NOT_REGISTERED: '此邮箱尚未注册，请先注册账号',
  EMAIL_ALREADY_REGISTERED: '此邮箱已注册，请直接登录或找回密码',
  CAMPUS_EMAIL_REQUIRED: '请使用获准的校园邮箱注册。',
  REGISTRATION_INVITE_REQUIRED: '此站点仅限受邀注册，请填写邀请码。',
  REGISTRATION_INVITE_INVALID: '邀请码无效、已使用或已过期。',
  REGISTRATION_USE_EMAIL: '请先在网页端完成邮箱注册，再绑定微信。',
  EMAIL_VERIFICATION_REQUIRED: '请先验证绑定邮箱',
  OTP_SEND_UNAVAILABLE: '邮件发送失败，请稍后重试',
  LOGIN_CHANNEL_UNAVAILABLE: '邮箱验证服务暂不可用',
  HANDLE_UNAVAILABLE: '这个用户名已被使用，请换一个',
  USERNAME_CHANGE_LIMIT: '用户名的一次修改机会已使用',
  HANDLE_REQUIRED: '请先保存账号用户名，再设置密码',
  USERNAME_UNAVAILABLE: '这个用户名已被使用，请换一个',
  INVALID_INPUT: '请检查输入格式，用户名需要 3–32 位字母、数字、下划线或连字符',
  REAUTHENTICATION_REQUIRED: '请先重新验证当前账号，再进行此操作',
  IDENTITY_ACCOUNT_CONFLICT: '此邮箱已属于另一个账号，请使用该账号登录',
  LAST_LOGIN_METHOD: '请先添加其他登录方式，再移除此项',
  LAST_WEB_LOGIN_METHOD: '请先添加另一个邮箱，保留网页端登录方式',
  OTP_INVALID_OR_EXPIRED: '验证码错误或已过期，请检查后重试',
  OTP_RESEND_TOO_SOON: '发送间隔不足，请稍后重试',
  BOUND_IDENTITY_REQUIRED: '请使用当前账号已绑定的邮箱验证',
  AUTH_REQUIRED: '登录已过期，请重新登录',
  INVALID_CREDENTIALS: '用户名、邮箱或密码错误，请检查后重试',
};
export async function accountRequest(path: string, body?: object) {
  if (body === undefined && path === '/api/backend/account')
    return accountResources.read(path, () => sendAccountRequest(path));
  if (body !== undefined) invalidateResources(undefined, false);
  try { return await sendAccountRequest(path, body); }
  finally { if (body !== undefined) invalidateResources(); }
}
async function sendAccountRequest(path: string, body?: object) {
  if(path==='/api/verification/request'&&body)body={...body,turnstileToken:await humanVerification()};
  const response = await fetch(path, {
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
    cache: 'no-store',
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const code = data && typeof data === 'object' && 'message' in data ? String(data.message) : '';
    throw Object.assign(new Error(
      messages[code] ||
        (response.status === 429 ? '请求频繁，请稍后再试' : '操作未完成，请重试，输入内容已保留'),
    ), {status:response.status});
  }
  return data;
}
