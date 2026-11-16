import { z } from 'zod';
export const OtpRequestSchema = z.strictObject({
  turnstileToken: z.string().min(1).max(2048).optional(),
  channel: z.enum(['email', 'sms']),
  recipient: z.string().min(1).max(254),
  purpose: z.enum(['login', 'link', 'reauth', 'recovery', 'register', 'password']).default('login'),
});
export const OtpVerifySchema = z.strictObject({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});
export const OtpChallengeSchema = z.strictObject({
  challengeId: z.uuid(),
  expiresAt: z.iso.datetime(),
  resendAfterSeconds: z.number().int().positive(),
});
export const AuthChannelsSchema = z.strictObject({
  guest: z.boolean(),
  password: z.boolean(),
  wechatMini: z.boolean(),
  wechatWeb: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
});
export const ClientAuthResultSchema = z.strictObject({
  actor: z.strictObject({
    userId: z.string().min(1),
    kind: z.enum(['guest', 'member']),
    platformRoles: z.array(z.string()),
  }),
});
export const AuthResultSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(),
  actor: z.strictObject({
    userId: z.string().min(1),
    kind: z.enum(['guest', 'member']),
    platformRoles: z.array(z.string()),
  }),
});
export const AuthMethodsSchema = z.strictObject({
  username: z.string().nullable(),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  wechat: z.boolean(),
  requiresReauthentication: z.boolean(),
});
export type AuthChannels = z.infer<typeof AuthChannelsSchema>;
export type AuthMethods = z.infer<typeof AuthMethodsSchema>;
export type OtpChallenge = z.infer<typeof OtpChallengeSchema>;
export type OtpRequest = z.input<typeof OtpRequestSchema>;
