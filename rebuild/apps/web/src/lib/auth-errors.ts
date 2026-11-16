const descriptions: Record<string, string> = {
  HUMAN_VERIFICATION_REQUIRED: '请先完成人机验证。',
  HUMAN_VERIFICATION_FAILED: '人机验证未通过，请重新验证。',
  HUMAN_VERIFICATION_UNAVAILABLE: '验证服务暂不可用，请稍后重试。',
  INVALID_CREDENTIALS: '用户名或密码不正确。',
  USERNAME_UNAVAILABLE: '用户名已被使用，请换一个。',
  TOO_MANY_ATTEMPTS: '尝试过于频繁，请稍后重试。',
  INVALID_INPUT: '请检查输入格式。',
  INVALID_EMAIL: '请输入有效的邮箱地址。',
  INVALID_PHONE: '请输入带国际区号的手机号，例如 +8613800000000。',
  ALREADY_REGISTERED: '当前已是正式账号，请直接登录。',
  LOGIN_CHANNEL_UNAVAILABLE: '这种验证方式暂未开放，请使用其他登录方式。',
  OTP_RESEND_TOO_SOON: '验证码请求过于频繁，请稍后重新获取。',
  OTP_RECIPIENT_LIMIT_REACHED: '这个地址请求过于频繁，请稍后再试。',
  OTP_DAILY_LIMIT_REACHED: '今日验证码发送额度已用完，请使用其他登录方式。',
  OTP_SEND_UNAVAILABLE: '验证码未能发送，请稍后重试或使用其他登录方式。',
  OTP_INVALID_OR_EXPIRED: '验证码不正确、已过期或已使用，请检查后重新获取。',
  IDENTITY_ACCOUNT_CONFLICT: '这个登录方式已经关联另一个账号，未更改绑定。',
  REAUTHENTICATION_REQUIRED: '请先重新登录验证身份，再完成此操作。',
  REGISTERED_ACCOUNT_REQUIRED: '请先升级为正式账号。',
  AUTH_REQUIRED: '请先登录后继续。',
};
export function authError(data: unknown): string {
  const key = data && typeof data === 'object' && 'message' in data ? String(data.message) : '';
  return descriptions[key] || '操作未完成，请稍后重试。';
}
