import { describe, it, expect, vi } from 'vitest';
import { SmtpOtpSender, type MailClient } from '../src/modules/identity/smtp-otp.sender.js';
import {
  TencentSmsOtpSender,
  type SmsClient,
} from '../src/modules/identity/tencent-sms-otp.sender.js';
const smtp = {
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls' as const,
  user: 'sender@example.com',
  password: 'test-secret',
  from: 'sender@example.com',
};
const sms = {
  secretId: 'test-id',
  secretKey: 'test-secret',
  appId: '1400000000',
  signName: '测试',
  templateId: '1234',
  region: 'ap-guangzhou',
  parameters: 'code,minutes' as const,
};
const message = {
  recipient: 'reader@example.com',
  code: '123456',
  challengeId: 'fake-challenge',
  expiresInMinutes: 10,
};
describe('real delivery adapters with transport isolation', () => {
  it('submits a plain text code only to the requested recipient and checks SMTP acceptance', async () => {
    const sendMail = vi
      .fn<MailClient['sendMail']>()
      .mockResolvedValue({ accepted: ['reader@example.com'], rejected: [] });
    await new SmtpOtpSender(smtp, { sendMail }).send(message);
    const payload = sendMail.mock.calls[0]![0];
    expect(payload.to).toBe('reader@example.com');
    expect(payload.text).toContain('123456');
    expect(payload.messageId).toBe('<fake-challenge@example.com>');
    expect(payload.html).toBeUndefined();
    sendMail.mockResolvedValue({ accepted: [], rejected: ['reader@example.com'] });
    await expect(new SmtpOtpSender(smtp, { sendMail }).send(message)).rejects.toThrow(
      'OTP_DELIVERY_REJECTED',
    );
  });
  it('sends one E.164 recipient with approved template parameters and checks the per-number result', async () => {
    const SendSms = vi
      .fn<SmsClient['SendSms']>()
      .mockResolvedValue({ SendStatusSet: [{ Code: 'Ok', PhoneNumber: '+8613800000000' }] });
    await new TencentSmsOtpSender(sms, { SendSms }).send({
      ...message,
      recipient: '+8613800000000',
    });
    const payload = SendSms.mock.calls[0]![0];
    expect(payload.PhoneNumberSet).toEqual(['+8613800000000']);
    expect(payload.TemplateParamSet).toEqual(['123456', '10']);
    expect(payload.SessionContext).toBe('fake-challenge');
    SendSms.mockResolvedValue({
      SendStatusSet: [{ Code: 'LimitExceeded', PhoneNumber: '+8613800000000' }],
    });
    await expect(
      new TencentSmsOtpSender(sms, { SendSms }).send({ ...message, recipient: '+8613800000000' }),
    ).rejects.toThrow('OTP_DELIVERY_REJECTED');
  });
  it('does not silently use a domestic SMS template for an overseas number', async () => {
    const SendSms = vi
      .fn<SmsClient['SendSms']>()
      .mockResolvedValue({ SendStatusSet: [{ Code: 'Ok', PhoneNumber: '+14155552671' }] });
    await expect(
      new TencentSmsOtpSender(sms, { SendSms }).send({ ...message, recipient: '+14155552671' }),
    ).rejects.toThrow('SMS_REGION_NOT_CONFIGURED');
    expect(SendSms).not.toHaveBeenCalled();
    await new TencentSmsOtpSender(
      { ...sms, internationalTemplateId: '5678', senderId: 'Umeet' },
      { SendSms },
    ).send({ ...message, recipient: '+14155552671' });
    expect(SendSms.mock.calls[0]![0].TemplateId).toBe('5678');
    expect(SendSms.mock.calls[0]![0].SenderId).toBe('Umeet');
  });
});
