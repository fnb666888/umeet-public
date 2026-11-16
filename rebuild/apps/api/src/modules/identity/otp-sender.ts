export type OtpChannel = 'email' | 'sms';
export type OtpMessage = {
  recipient: string;
  code: string;
  challengeId: string;
  expiresInMinutes: number;
};
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}
export type OtpSenders = Partial<Record<OtpChannel, OtpSender>>;
export type OtpPolicy = { hashKey: string; dailyLimits: { email: number; sms: number } };
export const OTP_SENDERS = Symbol.for('umeet.otp-senders');
