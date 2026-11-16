import { z } from 'zod';
import type { OtpPolicy, OtpSenders } from './otp-sender.js';
import { SmtpOtpSender, type SmtpConfiguration } from './smtp-otp.sender.js';
import { TencentSmsOtpSender, type TencentSmsConfiguration } from './tencent-sms-otp.sender.js';
export type OtpConfiguration = {
  policy: OtpPolicy;
  email?: SmtpConfiguration;
  sms?: TencentSmsConfiguration;
};
export function loadOtpConfiguration(env: NodeJS.ProcessEnv): OtpConfiguration | undefined {
  const emailEnabled = env['EMAIL_OTP_ENABLED'] || 'false',
    smsProvider = env['SMS_OTP_PROVIDER'] || 'disabled',
    hashKey = env['OTP_HASH_KEY'];
  if (!['true', 'false'].includes(emailEnabled)) throw new Error('OTP_CONFIGURATION_INVALID');
  if (!['disabled', 'tencent'].includes(smsProvider)) throw new Error('SMS_PROVIDER_UNSUPPORTED');
  if (emailEnabled === 'false' && smsProvider === 'disabled' && !hashKey) return undefined;
  if (!hashKey) throw new Error('OTP_HASH_KEY_REQUIRED');
  const result = z
    .object({
      hashKey: z.string().regex(/^[a-fA-F0-9]{64}$/),
      dailyLimits: z.object({
        email: z.coerce.number().int().min(0).max(10000),
        sms: z.coerce.number().int().min(0).max(10000),
      }),
    })
    .safeParse({
      hashKey,
      dailyLimits: {
        email: env['OTP_EMAIL_DAILY_LIMIT'] || '200',
        sms: env['OTP_SMS_DAILY_LIMIT'] || '20',
      },
    });
  if (!result.success) throw new Error('OTP_CONFIGURATION_INVALID');
  const config: OtpConfiguration = { policy: result.data };
  if (emailEnabled === 'true') {
    const security = env['SMTP_SECURITY'] || 'starttls';
    const email = z
      .object({
        host: z
          .string()
          .min(1)
          .max(253)
          .regex(/^[a-zA-Z0-9.-]+$/),
        port: z.coerce.number().int().min(1).max(65535),
        security: z.enum(['tls', 'starttls']),
        user: z.string().min(1).max(254),
        password: z.string().min(1),
        from: z.email().max(254),
      })
      .safeParse({
        host: env['SMTP_HOST'],
        port: env['SMTP_PORT'] || (security === 'tls' ? '465' : '587'),
        security,
        user: env['SMTP_USER'],
        password: env['SMTP_PASSWORD'],
        from: env['SMTP_FROM'],
      });
    if (!email.success) throw new Error('SMTP_CONFIGURATION_INVALID');
    config.email = email.data;
  }
  if (smsProvider === 'tencent') {
    const sms = z
      .object({
        secretId: z.string().min(1),
        secretKey: z.string().min(1),
        appId: z.string().regex(/^\d+$/),
        signName: z.string().min(1).max(100),
        templateId: z.string().regex(/^\d+$/),
        region: z.string().min(1),
        parameters: z.enum(['code', 'code,minutes']),
        internationalTemplateId: z.string().regex(/^\d+$/).optional(),
        internationalSignName: z.string().min(1).max(100).optional(),
        senderId: z.string().min(1).max(100).optional(),
      })
      .safeParse({
        secretId: env['TENCENT_SMS_SECRET_ID'],
        secretKey: env['TENCENT_SMS_SECRET_KEY'],
        appId: env['TENCENT_SMS_APP_ID'],
        signName: env['TENCENT_SMS_SIGN_NAME'],
        templateId: env['TENCENT_SMS_TEMPLATE_ID'],
        region: env['TENCENT_SMS_REGION'] || 'ap-guangzhou',
        parameters: env['TENCENT_SMS_PARAMETERS'] || 'code',
        ...(env['TENCENT_SMS_INTERNATIONAL_TEMPLATE_ID']
          ? { internationalTemplateId: env['TENCENT_SMS_INTERNATIONAL_TEMPLATE_ID'] }
          : {}),
        ...(env['TENCENT_SMS_INTERNATIONAL_SIGN_NAME']
          ? { internationalSignName: env['TENCENT_SMS_INTERNATIONAL_SIGN_NAME'] }
          : {}),
        ...(env['TENCENT_SMS_SENDER_ID'] ? { senderId: env['TENCENT_SMS_SENDER_ID'] } : {}),
      });
    if (!sms.success) throw new Error('SMS_CONFIGURATION_INVALID');
    const { internationalTemplateId, internationalSignName, senderId, ...required } = sms.data;
    if ((internationalSignName || senderId) && !internationalTemplateId)
      throw new Error('SMS_CONFIGURATION_INVALID');
    config.sms = {
      ...required,
      ...(internationalTemplateId ? { internationalTemplateId } : {}),
      ...(internationalSignName ? { internationalSignName } : {}),
      ...(senderId ? { senderId } : {}),
    };
  }
  return config;
}
export function createOtpSenders(config: OtpConfiguration | undefined): OtpSenders {
  return {
    ...(config?.email ? { email: new SmtpOtpSender(config.email) } : {}),
    ...(config?.sms ? { sms: new TencentSmsOtpSender(config.sms) } : {}),
  };
}
