export const PRODUCTION_API = 'https://example.com/api/mobile';
export function apiBase() {
  const env = wx.getAccountInfoSync().miniProgram.envVersion;
  if (env === 'develop') {
    const value = wx.getStorageSync('umeet:dev-api');
    if (
      typeof value === 'string' &&
      /^http:\/\/(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?\/api\/mobile$/.test(
        value,
      )
    )
      return value;
    return 'http://127.0.0.1:5178/api/mobile';
  }
  return PRODUCTION_API;
}
export const API_BASE = PRODUCTION_API;
