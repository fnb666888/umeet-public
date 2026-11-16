import { describe, it, expect } from 'vitest';
import { loadAuthConfiguration } from '../src/modules/identity/auth-configuration.js';
describe('explicit self-owned auth configuration', () => {
  it('keeps external login disabled with no app configuration and rejects incomplete secret pairs', () => {
    expect(loadAuthConfiguration({})).toEqual({});
    expect(() => loadAuthConfiguration({ WECHAT_MINI_APP_ID: 'wx1234567890abcdef' })).toThrow(
      'WECHAT_CONFIGURATION_INCOMPLETE',
    );
    expect(() => loadAuthConfiguration({ WECHAT_MINI_APP_SECRET: 'never-log-this' })).toThrow(
      'WECHAT_CONFIGURATION_INCOMPLETE',
    );
  });
  it('loads the explicit mini application without automatically assuming a UnionID realm', () => {
    const result = loadAuthConfiguration({
      WECHAT_MINI_APP_ID: 'wx1234567890abcdef',
      WECHAT_MINI_APP_SECRET: 'test-only-secret',
    });
    expect(result.wechatMini?.appId).toBe('wx1234567890abcdef');
    expect(result.wechatMini?.unionRealm).toBeUndefined();
  });
});
