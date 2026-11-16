import { describe, it, expect } from 'vitest';
import { loadAuthConfiguration } from '../src/modules/identity/auth-configuration.js';
import { loadOtpConfiguration } from '../src/modules/identity/otp-configuration.js';
const email = {
  EMAIL_OTP_ENABLED: 'true',
  OTP_HASH_KEY: 'b'.repeat(64),
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'sender@example.com',
  SMTP_PASSWORD: 'test-secret',
  SMTP_FROM: 'sender@example.com',
};
describe('default-disabled real sending configuration', () => {
  it('does not enable sending merely because SMTP fields or a hash key are present', () => {
    expect(loadOtpConfiguration({})).toBeUndefined();
    expect(loadAuthConfiguration({ SMTP_HOST: 'smtp.example.com' })).toEqual({});
    const policyOnly = loadOtpConfiguration({ OTP_HASH_KEY: 'a'.repeat(64) });
    expect(policyOnly?.email).toBeUndefined();
    expect(policyOnly?.sms).toBeUndefined();
  });
  it('requires a strong separate OTP key and complete SMTP credentials before enabling email', () => {
    expect(() => loadOtpConfiguration({ ...email, OTP_HASH_KEY: '' })).toThrow(
      'OTP_HASH_KEY_REQUIRED',
    );
    expect(() => loadOtpConfiguration({ ...email, OTP_HASH_KEY: 'short' })).toThrow(
      'OTP_CONFIGURATION_INVALID',
    );
    expect(() => loadOtpConfiguration({ ...email, SMTP_PASSWORD: '' })).toThrow(
      'SMTP_CONFIGURATION_INVALID',
    );
    const config = loadAuthConfiguration(email);
    expect(config.otp?.email?.security).toBe('starttls');
    expect(config.otp?.policy.dailyLimits).toEqual({ email: 200, sms: 20 });
  });
  it('never enables console/fake SMS and requires explicit optional provider configuration', () => {
    expect(() => loadOtpConfiguration({ SMS_OTP_PROVIDER: 'console' })).toThrow(
      'SMS_PROVIDER_UNSUPPORTED',
    );
    expect(() =>
      loadOtpConfiguration({ SMS_OTP_PROVIDER: 'tencent', OTP_HASH_KEY: 'b'.repeat(64) }),
    ).toThrow('SMS_CONFIGURATION_INVALID');
    const config = loadOtpConfiguration({
      SMS_OTP_PROVIDER: 'tencent',
      OTP_HASH_KEY: 'b'.repeat(64),
      TENCENT_SMS_SECRET_ID: 'test-id',
      TENCENT_SMS_SECRET_KEY: 'test-key',
      TENCENT_SMS_APP_ID: '1400000000',
      TENCENT_SMS_SIGN_NAME: '测试',
      TENCENT_SMS_TEMPLATE_ID: '1234',
      OTP_SMS_DAILY_LIMIT: '0',
    });
    expect(config?.sms?.parameters).toBe('code');
    expect(config?.policy.dailyLimits.sms).toBe(0);
  });
});
