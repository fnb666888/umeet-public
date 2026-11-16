import type { VerifiedLoginProof } from './auth-provider.js';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
export type WechatMiniConfiguration = { appId: string; appSecret: string; unionRealm?: string };
export class WechatMiniAdapter {
  constructor(
    private readonly config: WechatMiniConfiguration,
    private readonly transport: typeof fetch = fetch,
  ) {}
  async verify(code: string): Promise<VerifiedLoginProof> {
    if (!z.string().min(1).max(512).safeParse(code).success)
      throw new BadRequestException('INVALID_INPUT');
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({
      appid: this.config.appId,
      secret: this.config.appSecret,
      js_code: code,
      grant_type: 'authorization_code',
    }).toString();
    let value: unknown;
    try {
      const response = await this.transport(url, {
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('UPSTREAM_FAILED');
      value = await response.json();
    } catch {
      throw new ServiceUnavailableException('WECHAT_UNAVAILABLE');
    }
    const parsed = z
      .object({
        openid: z.string().min(1).max(200).optional(),
        unionid: z.string().min(1).max(200).optional(),
        errcode: z.number().optional(),
      })
      .safeParse(value);
    if (!parsed.success) throw new ServiceUnavailableException('WECHAT_UNAVAILABLE');
    if (parsed.data.errcode === 40029 || parsed.data.errcode === 40163)
      throw new UnauthorizedException('WECHAT_CODE_INVALID');
    if ((parsed.data.errcode !== undefined && parsed.data.errcode !== 0) || !parsed.data.openid)
      throw new ServiceUnavailableException('WECHAT_UNAVAILABLE');
    const identities = [
      { provider: 'wechat-mini:' + this.config.appId, subject: parsed.data.openid },
    ];
    if (parsed.data.unionid && this.config.unionRealm)
      identities.push({
        provider: 'wechat-union:' + this.config.unionRealm,
        subject: parsed.data.unionid,
      });
    return { identities, nickname: '微信用户' };
  }
}
