// Synthetic format-valid AppID for isolated tests; never a real application.
const TEST_WECHAT_APP_ID = 'wx' + '0'.repeat(16);
import { describe, it, expect, vi } from 'vitest';
import { WechatMiniAdapter } from '../src/modules/identity/wechat-mini.adapter.js';
describe('server-side WeChat code verification', () => {
  it('exchanges only with the fixed WeChat endpoint and never exposes session_key or app secret', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            openid: 'verified-openid',
            unionid: 'verified-unionid',
            session_key: 'never-return-this-key',
          }),
        ),
      );
    const proof = await new WechatMiniAdapter(
      {
        appId: TEST_WECHAT_APP_ID,
        appSecret: 'test-only-secret',
        unionRealm: 'our-open-platform',
      },
      transport,
    ).verify('one-time-code');
    const url = new URL(String(transport.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://api.weixin.qq.com/sns/jscode2session');
    expect(url.searchParams.get('js_code')).toBe('one-time-code');
    expect(url.searchParams.get('grant_type')).toBe('authorization_code');
    expect(proof.identities).toEqual([
      { provider: `wechat-mini:${TEST_WECHAT_APP_ID}`, subject: 'verified-openid' },
      { provider: 'wechat-union:our-open-platform', subject: 'verified-unionid' },
    ]);
    expect(JSON.stringify(proof)).not.toContain('never-return');
    expect(JSON.stringify(proof)).not.toContain('test-only-secret');
  });
  it('does not use an unscoped UnionID and maps provider failures to sanitized application errors', async () => {
    const config = { appId: TEST_WECHAT_APP_ID, appSecret: 'test-only-secret' };
    const ok = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ openid: 'id', unionid: 'not-scoped', session_key: 'key' })),
      );
    expect((await new WechatMiniAdapter(config, ok).verify('code')).identities).toHaveLength(1);
    const bad = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ errcode: 40029, errmsg: 'includes-secret-we-must-not-forward' }),
        ),
      );
    await expect(new WechatMiniAdapter(config, bad).verify('bad-code')).rejects.toThrow(
      'WECHAT_CODE_INVALID',
    );
    const outage = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('request URL includes test-only-secret'));
    await expect(new WechatMiniAdapter(config, outage).verify('code')).rejects.toThrow(
      'WECHAT_UNAVAILABLE',
    );
  });
});
