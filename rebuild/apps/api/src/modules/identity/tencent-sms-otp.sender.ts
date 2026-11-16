import type { sms } from 'tencentcloud-sdk-nodejs-sms';
import tencentcloud from 'tencentcloud-sdk-nodejs-sms';
import type { OtpSender, OtpMessage } from './otp-sender.js';
export type TencentSmsConfiguration = {
  secretId: string;
  secretKey: string;
  appId: string;
  signName: string;
  templateId: string;
  region: string;
  parameters: 'code' | 'code,minutes';
  internationalTemplateId?: string;
  internationalSignName?: string;
  senderId?: string;
};
export type SmsClient = Pick<InstanceType<typeof sms.v20210111.Client>, 'SendSms'>;
export class TencentSmsOtpSender implements OtpSender {
  private readonly client: SmsClient;
  constructor(
    private readonly config: TencentSmsConfiguration,
    client?: SmsClient,
  ) {
    this.client =
      client ||
      new tencentcloud.sms.v20210111.Client({
        credential: { secretId: config.secretId, secretKey: config.secretKey },
        region: config.region,
        profile: {
          signMethod: 'TC3-HMAC-SHA256',
          httpProfile: {
            endpoint: 'sms.tencentcloudapi.com',
            protocol: 'https://',
            reqTimeout: 10,
          },
        },
      });
  }
  async send(message: OtpMessage): Promise<void> {
    const international = !message.recipient.startsWith('+86');
    if (international && !this.config.internationalTemplateId)
      throw new Error('SMS_REGION_NOT_CONFIGURED');
    const sign = international ? this.config.internationalSignName : this.config.signName;
    let result: Awaited<ReturnType<SmsClient['SendSms']>>;
    try {
      result = await this.client.SendSms({
        PhoneNumberSet: [message.recipient],
        SmsSdkAppId: this.config.appId,
        TemplateId: international ? this.config.internationalTemplateId! : this.config.templateId,
        TemplateParamSet:
          this.config.parameters === 'code,minutes'
            ? [message.code, String(message.expiresInMinutes)]
            : [message.code],
        SessionContext: message.challengeId,
        ...(sign ? { SignName: sign } : {}),
        ...(international && this.config.senderId ? { SenderId: this.config.senderId } : {}),
      });
    } catch {
      throw new Error('OTP_DELIVERY_UNAVAILABLE');
    }
    if (
      result.SendStatusSet?.length !== 1 ||
      result.SendStatusSet[0]?.Code !== 'Ok' ||
      result.SendStatusSet[0].PhoneNumber !== message.recipient
    )
      throw new Error('OTP_DELIVERY_REJECTED');
  }
}
