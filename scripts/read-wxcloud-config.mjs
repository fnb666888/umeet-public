import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(root, '.env.wxcloud');
let text = readFileSync(filename, 'utf8');
const local = dotenv.parse(text);
const cli = path.join(process.env.LOCALAPPDATA, 'Umeet/wxcloud-cli/node_modules/@wxcloud/cli/bin/run');
try {
  const output = execFileSync(process.execPath, [cli, 'service:config', 'read',
    '--envId', local.WXCLOUD_ENV_ID, '--serviceName', local.WXCLOUD_SERVICE_NAME,
    '--region', local.WXCLOUD_REGION || 'ap-shanghai'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  }).replace(/\x1b\[[0-9;]*m/g, '');
  const detail = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
  const params = typeof detail.envParams === 'string' ? JSON.parse(detail.envParams) : (detail.envParams || {});
  console.log(JSON.stringify({service: local.WXCLOUD_SERVICE_NAME, environmentKeys: Object.keys(params)}, null, 2));
  const copy = {};
  for (const key of ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE',
    'COS_BUCKET', 'COS_REGION', 'REDIS_URL', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']) {
    if (!local[key] && typeof params[key] === 'string' && params[key]) copy[key] = params[key];
  }
  if (!local.MYSQL_USER && params.MYSQL_USERNAME) copy.MYSQL_USER = params.MYSQL_USERNAME;
  if (!local.MYSQL_HOST && params.MYSQL_ADDRESS) {
    const address = new URL(`mysql://${params.MYSQL_ADDRESS}`);
    copy.MYSQL_HOST = address.hostname;
    copy.MYSQL_PORT = address.port || '3306';
  }
  for (const [key, value] of Object.entries(copy)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, () => line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(filename, text, { mode: 0o600 });
  console.log(JSON.stringify({copiedKeys: Object.keys(copy)}, null, 2));
} catch {
  console.error('读取服务配置失败；没有输出原始配置或密钥。');
  process.exitCode = 1;
}
