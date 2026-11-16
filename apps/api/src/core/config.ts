import dotenv from 'dotenv';
import path from 'node:path';
import { databaseProvider } from './database-dialect';
export const ROOT = path.resolve(__dirname, '../../../..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
export const demoMode = () =>
  process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true';
export function checkConfig() {
  databaseProvider();
  if (
    !Number.isInteger(Number(process.env.VERIFICATION_RETENTION_DAYS || 7)) ||
    Number(process.env.VERIFICATION_RETENTION_DAYS || 7) < 1
  )
    throw new Error('认证材料保留期必须为正整数天');
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET || !process.env.ADMIN_PASSWORD)
    throw new Error('请先执行 npm run setup 或配置环境变量');
  if (process.env.NODE_ENV === 'production') {
    if (process.env.DEMO_MODE === 'true' || process.env.LOCAL_DATABASE === 'true')
      throw new Error('生产环境禁止演示登录及内嵌数据库');
    if (
      process.env.JWT_SECRET.length < 40 ||
      process.env.ADMIN_PASSWORD.length < 20 ||
      /CHANGE_ME/.test(process.env.JWT_SECRET + process.env.ADMIN_PASSWORD)
    )
      throw new Error('生产密钥不符合要求');
    if (!['database', 'redis'].includes(process.env.TASK_TRANSPORT || 'redis'))
      throw new Error('TASK_TRANSPORT 必须为 database 或 redis');
    if (process.env.TASK_TRANSPORT !== 'database' && !process.env.REDIS_URL)
      throw new Error('Redis 任务模式需要 REDIS_URL');
    if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET)
      throw new Error('生产环境需要微信配置');
    if (!['s3', 'wxcloud-cos'].includes(process.env.STORAGE_PROVIDER || ''))
      throw new Error('生产环境需要 S3 或微信云托管 COS 对象存储');
    if (process.env.STORAGE_PROVIDER === 's3' && (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY))
      throw new Error('对象存储配置不完整');
    if (process.env.STORAGE_PROVIDER === 'wxcloud-cos' && (!process.env.COS_BUCKET || !process.env.COS_REGION))
      throw new Error('微信云托管 COS_BUCKET/COS_REGION 未配置');
    if (!process.env.PUBLIC_API_URL?.startsWith('https://'))
      throw new Error('生产 PUBLIC_API_URL 必须使用 HTTPS');
  }
  if (process.env.WECHAT_SUBSCRIBE_TEMPLATE) {
    const map = JSON.parse(process.env.WECHAT_SUBSCRIBE_FIELD_MAP || '{}');
    if (!map.title || !map.body || !map.time) throw new Error('订阅消息需要实际模板字段映射');
  }
}
