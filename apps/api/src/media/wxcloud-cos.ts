import COS from 'cos-nodejs-sdk-v5';

interface Credentials { TmpSecretId: string; TmpSecretKey: string; Token: string; ExpiredTime: number; }

/** 云托管内网凭据接口；密钥仅存在服务端内存，绝不返回客户端。 */
export class WxcloudCos {
  private cached?: Credentials;
  private refreshing?: Promise<Credentials>;
  private bucket = process.env.COS_BUCKET!;
  private region = process.env.COS_REGION!;
  private async credentials(): Promise<Credentials> {
    if (this.cached && this.cached.ExpiredTime > Date.now() / 1000 + 120) return this.cached;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const response = await fetch('http://api.weixin.qq.com/_/cos/getauth', { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('云托管存储凭据获取失败');
        const value: unknown = await response.json();
        if (!value || typeof value !== 'object') throw new Error('云托管存储凭据格式错误');
        const v = value as Record<string, unknown>;
        if (typeof v.TmpSecretId !== 'string' || typeof v.TmpSecretKey !== 'string' || typeof v.Token !== 'string' ||
            typeof v.ExpiredTime !== 'number' || v.ExpiredTime <= Date.now() / 1000 + 30)
          throw new Error('云托管存储凭据无效');
        this.cached = v as unknown as Credentials;
        return this.cached;
      })().finally(() => { this.refreshing = undefined; });
    }
    return this.refreshing;
  }
  private async client() {
    const c = await this.credentials();
    return new COS({ SecretId: c.TmpSecretId, SecretKey: c.TmpSecretKey, SecurityToken: c.Token,
      Protocol: 'https:', Timeout: 15000, ForceSignHost: true });
  }
  private params(key: string) { return { Bucket: this.bucket, Region: this.region, Key: 'umeet/private/' + key }; }
  async put(key: string, body: Buffer, mime: string) {
    const client = await this.client();
    await client.putObject({ ...this.params(key), Body: body, ContentType: mime, ACL: 'private' });
    // 验证桶策略没有使私有上传公开；拒绝保存可匿名读取的认证材料。
    try {
      const url = `https://${this.bucket}.cos.${this.region}.myqcloud.com/umeet/private/${encodeURIComponent(key)}`;
      const check = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (check.status !== 403) throw new Error('云存储匿名访问未被拒绝，请检查 COS 桶策略');
    } catch (error) {
      await client.deleteObject(this.params(key)).catch(() => {});
      throw error;
    }
  }
  async get(key: string) { return (await (await this.client()).getObject(this.params(key))).Body; }
  async remove(key: string) { await (await this.client()).deleteObject(this.params(key)); }
}
