import nodemailer, { type SendMailOptions } from 'nodemailer';
import { z } from 'zod';
import type { OtpSender, OtpMessage } from './otp-sender.js';
export type SmtpConfiguration = {
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  user: string;
  password: string;
  from: string;
};
export interface MailClient {
  sendMail(options: SendMailOptions): Promise<unknown>;
}
export class SmtpOtpSender implements OtpSender {
  private readonly client: MailClient;
  constructor(
    private readonly config: SmtpConfiguration,
    client?: MailClient,
  ) {
    this.client =
      client ||
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.security === 'tls',
        requireTLS: config.security === 'starttls',
        auth: { user: config.user, pass: config.password },
        tls: { rejectUnauthorized: true },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
  }
  async send(message: OtpMessage): Promise<void> {
    let value: unknown;
    try {
      value = await this.client.sendMail({
        from: this.config.from,
        to: message.recipient,
        subject: 'Umeet 验证码',
        text:
          '你的 Umeet 验证码是 ' +
          message.code +
          '，' +
          message.expiresInMinutes +
          ' 分钟内有效。请勿向他人透露。若非本人操作，请忽略此邮件。',
        messageId: '<' + message.challengeId + '@' + this.config.from.split('@').at(-1) + '>',
      });
    } catch {
      throw new Error('OTP_DELIVERY_UNAVAILABLE');
    }
    const result = z
      .object({ accepted: z.array(z.union([z.string(), z.object({ address: z.string() })])) })
      .safeParse(value);
    if (
      !result.success ||
      !result.data.accepted.some(
        (address) =>
          (typeof address === 'string' ? address : address.address) === message.recipient,
      )
    )
      throw new Error('OTP_DELIVERY_REJECTED');
  }
}
