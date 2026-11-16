import type { WechatMiniConfiguration } from './wechat-mini.adapter.js';
import { z } from 'zod';
import { loadOtpConfiguration, type OtpConfiguration } from './otp-configuration.js';
export type AuthConfiguration = { wechatMini?: WechatMiniConfiguration; otp?: OtpConfiguration };
export const AUTH_CONFIGURATION = Symbol.for('umeet.auth-configuration');
export function loadAuthConfiguration(env: NodeJS.ProcessEnv): AuthConfiguration {
  const otp = loadOtpConfiguration(env),
    wechatMini = loadWechatConfiguration(env);
  return { ...(wechatMini ? { wechatMini } : {}), ...(otp ? { otp } : {}) };
}
function loadWechatConfiguration(env: NodeJS.ProcessEnv): WechatMiniConfiguration | undefined {
  const appId = env['WECHAT_MINI_APP_ID'],
    appSecret = env['WECHAT_MINI_APP_SECRET'],
    unionRealm = env['WECHAT_OPEN_PLATFORM_REALM'];
  if (!appId && !appSecret && !unionRealm) return undefined;
  if (!appId || !appSecret) throw new Error('WECHAT_CONFIGURATION_INCOMPLETE');
  const parsed = z
    .object({
      appId: z.string().regex(/^wx[0-9a-f]{16}$/),
      appSecret: z.string().min(1).max(256),
      unionRealm: z
        .string()
        .regex(/^[a-z0-9_-]{1,64}$/)
        .optional(),
    })
    .safeParse({ appId, appSecret, ...(unionRealm ? { unionRealm } : {}) });
  if (!parsed.success) throw new Error('WECHAT_CONFIGURATION_INVALID');
  return {
    appId: parsed.data.appId,
    appSecret: parsed.data.appSecret,
    ...(parsed.data.unionRealm ? { unionRealm: parsed.data.unionRealm } : {}),
  };
}
