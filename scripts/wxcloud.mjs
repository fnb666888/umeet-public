import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] || 'check';
const configFile = path.join(root, '.env.wxcloud');
const config = existsSync(configFile) ? dotenv.parse(readFileSync(configFile)) : {};
if (!config.DATABASE_URL && config.MYSQL_HOST && config.MYSQL_USER && config.MYSQL_PASSWORD) {
  const url = new URL('mysql://localhost');
  url.hostname = config.MYSQL_HOST;
  url.port = config.MYSQL_PORT || '3306';
  url.username = config.MYSQL_USER;
  url.password = config.MYSQL_PASSWORD;
  url.pathname = '/' + (config.MYSQL_DATABASE || 'umeet');
  config.DATABASE_URL = url.toString();
}
config.DATABASE_PROVIDER ||= config.DATABASE_URL?.startsWith('mysql:') ? 'mysql' : 'postgresql';
if (config.MYSQL_HOST) config.MYSQL_ADDRESS ||= `${config.MYSQL_HOST}:${config.MYSQL_PORT || 3306}`;
config.MYSQL_USERNAME ||= config.MYSQL_USER;
const cliRoot = process.env.WXCLOUD_CLI_HOME || path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'Umeet', 'wxcloud-cli',
);
const cli = path.join(cliRoot, 'node_modules/@wxcloud/cli/bin/run');
const appKeys = [
  'MYSQL_ADDRESS', 'MYSQL_USERNAME', 'MYSQL_PASSWORD', 'DATABASE_PROVIDER', 'DATABASE_URL', 'DATABASE_POOL_SIZE', 'TASK_TRANSPORT', 'COS_BUCKET', 'COS_REGION', 'REDIS_URL', 'JWT_SECRET', 'ADMIN_PASSWORD', 'WECHAT_APP_ID',
  'WECHAT_APP_SECRET', 'STORAGE_PROVIDER', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET',
  'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'PUBLIC_API_URL', 'CORS_ORIGINS',
  'VERIFICATION_RETENTION_DAYS', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD',
  'SMTP_FROM', 'WECHAT_SUBSCRIBE_TEMPLATE', 'WECHAT_SUBSCRIBE_FIELD_MAP',
];
const envParams = Object.fromEntries(appKeys.filter((key) => config[key]).map((key) => [key, config[key]]));
Object.assign(envParams, { NODE_ENV: 'production', LOCAL_DATABASE: 'false', DEMO_MODE: 'false' });
const region = config.WXCLOUD_REGION || 'ap-shanghai';
function validate() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'ADMIN_PASSWORD', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'PUBLIC_API_URL'];
  if (config.TASK_TRANSPORT !== 'database') required.push('REDIS_URL');
  if (config.STORAGE_PROVIDER === 'wxcloud-cos') required.push('COS_BUCKET', 'COS_REGION');
  else required.push('S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY');
  const missing = required.filter((key) => !config[key]);
  if (missing.length) throw new Error(`.env.wxcloud 缺少：${missing.join(', ')}`);
  for (const [key, protocols] of [['DATABASE_URL', ['mysql:']], ...(config.TASK_TRANSPORT !== 'database' ? [['REDIS_URL', ['redis:', 'rediss:']]] : [])]) {
    let url;
    try { url = new URL(config[key]); } catch { throw new Error(`${key} URL 格式错误`); }
    if (!protocols.includes(url.protocol)) throw new Error(`${key} 协议错误`);
    if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname))
      throw new Error(`${key} 不能使用本机地址`);
  }
  for (const key of ['PUBLIC_API_URL', ...(config.STORAGE_PROVIDER === 's3' ? ['S3_ENDPOINT'] : [])]) {
    let url;
    try { url = new URL(config[key]); } catch { throw new Error(`${key} URL 格式错误`); }
    if (url.protocol !== 'https:') throw new Error(`${key} 必须使用 HTTPS`);
  }
  if (config.JWT_SECRET.length < 40 || config.ADMIN_PASSWORD.length < 20 ||
    /CHANGE_ME/.test(config.JWT_SECRET + config.ADMIN_PASSWORD)) throw new Error('生产密钥不符合要求');
  if (!['s3', 'wxcloud-cos'].includes(config.STORAGE_PROVIDER)) throw new Error('STORAGE_PROVIDER 必须为 s3 或 wxcloud-cos');
  if (config.DATABASE_PROVIDER !== 'mysql') throw new Error('此部署包使用 MySQL 构建，DATABASE_PROVIDER 必须为 mysql');
  if (!['database', 'redis'].includes(config.TASK_TRANSPORT || 'redis')) throw new Error('TASK_TRANSPORT 配置错误');
  if (config.WECHAT_APP_ID !== (config.WXCLOUD_APP_ID || 'YOUR_WECHAT_APP_ID'))
    throw new Error('服务端微信 AppID 与云托管登录 AppID 不一致');
  if (!['ap-shanghai', 'ap-guangzhou', 'ap-beijing'].includes(region)) throw new Error('WXCLOUD_REGION 不受 CLI 支持');
  if (config.WECHAT_SUBSCRIBE_TEMPLATE) {
    let map;
    try { map = JSON.parse(config.WECHAT_SUBSCRIBE_FIELD_MAP || '{}'); }
    catch { throw new Error('WECHAT_SUBSCRIBE_FIELD_MAP 必须是 JSON'); }
    if (!map.title || !map.body || !map.time) throw new Error('订阅模板需要 title/body/time 字段映射');
  }
  console.log('生产配置格式检查通过；远程依赖连通性将在容器启动时验证。');
}
function stage() {
  const dir = path.join(root, 'artifacts', `wxcloud-source-${Date.now()}-${randomBytes(3).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  let count = 0;
  function copy(relative) {
    const src = path.join(root, relative), dst = path.join(dir, relative);
    const stat = lstatSync(src);
    if (stat.isSymbolicLink()) throw new Error(`部署源不能包含符号链接：${relative}`);
    if (stat.isDirectory()) {
      mkdirSync(dst, { recursive: true });
      for (const name of readdirSync(src)) {
        if (/^(node_modules|dist|test|tests|coverage|artifacts|\.git|\.env(?:\..*)?)$/.test(name) ||
          /\.(?:key|pem|log)$/i.test(name) || name === 'project.private.config.json') continue;
        copy(path.join(relative, name));
      }
    } else {
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      count++;
    }
  }
  // Explicit source allowlist: no repository root secrets, local data or mini-program upload key.
  for (const relative of ['package.json', 'package-lock.json', '.dockerignore',
    'apps/api/package.json', 'apps/api/tsconfig.json', 'apps/api/prisma.config.ts',
    'apps/api/src', 'apps/api/prisma', 'apps/admin/package.json', 'apps/admin/tsconfig.json',
    'apps/admin/vite.config.ts', 'apps/admin/index.html', 'apps/admin/src',
    'apps/miniprogram/package.json', 'deploy/cloudrun']) copy(relative);
  if (existsSync(path.join(root, 'apps/admin/public'))) copy('apps/admin/public');
  const localConfig = existsSync(path.join(root, '.env')) ? dotenv.parse(readFileSync(path.join(root, '.env'))) : {};
  const secrets = [...Object.entries(localConfig), ...Object.entries(config)]
    .filter(([key, value]) => /SECRET|PASSWORD|CLI_KEY|ACCESS_KEY/.test(key) && value.length >= 8)
    .map(([, value]) => value);
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else {
        const data = readFileSync(file, 'utf8');
        if (secrets.some((value) => data.includes(value)))
          throw new Error(`构建源含已知密钥，禁止上传：${path.relative(dir, file)}`);
      }
    }
  }
  scan(dir);
  console.log(`部署源准备完成：${count} 个文件，${dir}`);
  return dir;
}
async function runCli(args, { json = false } = {}) {
  if (!existsSync(cli)) throw new Error(`CLI 未安装。请运行 npm install --prefix "${cliRoot}" @wxcloud/cli@2.3.3 --no-audit --no-fund`);
  console.log(`执行微信云托管 CLI：${args[0]}`);
  // Official CLI prints env values in its confirmation table; capture rather than forward it.
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root, env: { ...process.env, FORCE_COLOR: '0' }, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], shell: false,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-8 * 1024 * 1024); });
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-1024 * 1024); });
    const timer = setInterval(() => console.log(`CLI ${args[0]} 仍在执行…`), 30000);
    child.on('error', () => { clearInterval(timer); reject(new Error('无法启动云托管 CLI')); });
    child.on('close', (code) => {
      clearInterval(timer);
      if (code !== 0) {
        const secrets = [...Object.values(config), ...Object.values(envParams)].filter(value => typeof value === 'string' && value.length >= 8);
        let safe = (stdout + '\n' + stderr).replace(/\x1b\[[0-9;]*m/g, '');
        for (const secret of secrets.sort((a,b) => b.length-a.length)) {
          for (const value of [secret, JSON.stringify(secret).slice(1,-1), encodeURIComponent(secret)]) safe = safe.split(value).join('[redacted]');
        }
        mkdirSync(path.join(root, 'artifacts'), { recursive: true });
        const log = path.join(root, 'artifacts', 'wxcloud-last-error.redacted.log');
        writeFileSync(log, safe);
        console.log(`脱敏错误日志：${log}`);
        console.log(safe.split(/\r?\n/).filter(line => /Error|错误|失败|invalid|cannot|cannot|ENOENT|EACCES/i.test(line)).slice(-8).join('\n'));
        const reason = /尚未登录/.test(stdout + stderr) ? '尚未登录；请配置专用 CLI 密钥后运行 login。' :
          '请在云托管控制台查看该操作的错误或构建日志；原始输出未显示，以免泄露密钥。';
        reject(new Error(`CLI ${args[0]} 失败（退出码 ${code}）。${reason}`));
      } else resolve(stdout);
    });
  });
  if (!json) return;
  for (const line of output.split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.code === 0 && 'data' in parsed) return parsed.data;
    } catch {}
  }
  throw new Error('CLI 未返回可识别的 JSON 结果');
}
async function login() {
  if (!config.WXCLOUD_CLI_KEY) throw new Error('.env.wxcloud 缺少 WXCLOUD_CLI_KEY（微信云托管专用 CLI 密钥）');
  await runCli(['login', '--appId', config.WXCLOUD_APP_ID || 'YOUR_WECHAT_APP_ID', '--privateKey', config.WXCLOUD_CLI_KEY]);
  console.log('微信云托管 CLI 登录成功。');
}
async function waitTask({ allowFailed = false } = {}) {
  const require = createRequire(path.join(cliRoot, 'node_modules/@wxcloud/cli/package.json'));
  const api = require('./lib/api');
  require('./lib/api/common').setApiCommonParameters({ region });
  const deadline = Date.now() + 15 * 60000;
  let previous = '';
  while (Date.now() < deadline) {
    const result = await api.DescribeServerManageTask({ EnvId: config.WXCLOUD_ENV_ID, ServerName: config.WXCLOUD_SERVICE_NAME });
    const task = result.Task;
    const status = `${task?.Status || 'none'}: ${task?.Steps?.filter(s => s.Status === 'running').map(s => s.Name).join(', ') || ''}`;
    if (status !== previous) { console.log(`云端任务状态：${status}`); previous = status; }
    if (!result.IsExist || task?.Status === 'finished') {
      if (task?.FailReason || task?.Steps?.some(s => s.Status === 'failed')) throw new Error('云端任务失败，请运行 node scripts/wxcloud-status.mjs --logs 获取脱敏日志');
      return;
    }
    if (task?.Status === 'failed') {
      if (allowFailed) return;
      throw new Error('云端任务失败');
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('云端任务等待超时；请检查状态，不要重复提交');
}
async function main() {
  if (action === 'init') {
    if (existsSync(configFile)) throw new Error('.env.wxcloud 已存在，未覆盖');
    const local = existsSync(path.join(root, '.env')) ? dotenv.parse(readFileSync(path.join(root, '.env'))) : {};
    const values = {
      JWT_SECRET: randomBytes(48).toString('hex'), ADMIN_PASSWORD: randomBytes(24).toString('hex'),
      WECHAT_APP_SECRET: local.WECHAT_APP_SECRET || '',
    };
    const template = readFileSync(path.join(root, 'deploy/cloudrun/env.example'), 'utf8');
    writeFileSync(configFile, template.replace(/^(JWT_SECRET|ADMIN_PASSWORD|WECHAT_APP_SECRET)=$/gm,
      (_, key) => `${key}=${JSON.stringify(values[key])}`), { mode: 0o600, flag: 'wx' });
    console.log('已创建 .env.wxcloud，生成独立生产密钥并填入已有 AppSecret；未显示任何密钥。');
    return;
  }
  if (action === 'prepare') { stage(); return; }
  if (action === 'check') { validate(); return; }
  if (action === 'login') { await login(); return; }
  if (action === 'envs') {
    const envs = await runCli(['env:list', '--region', region, '--json'], { json: true });
    console.log(JSON.stringify(envs, null, 2)); return;
  }
  if (!['services', 'deploy'].includes(action)) throw new Error('用法：node scripts/wxcloud.mjs init|prepare|check|login|envs|services|deploy');
  if (!config.WXCLOUD_ENV_ID) throw new Error('请先运行 envs，再把选中的环境 ID 填入 WXCLOUD_ENV_ID');
  const flags = ['--envId', config.WXCLOUD_ENV_ID, '--region', region];
  if (action === 'services') {
    console.log(JSON.stringify(await runCli(['service:list', ...flags, '--json'], { json: true }), null, 2)); return;
  }
  validate();
  const name = config.WXCLOUD_SERVICE_NAME || 'umeet';
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(name)) throw new Error('WXCLOUD_SERVICE_NAME 格式错误');
  const source = stage();
  const services = await runCli(['service:list', ...flags, '--json'], { json: true });
  const existing = services.find((service) => service.ServerName === name);
  if (!existing) throw new Error('指定的原服务不存在，未创建新服务');
  await waitTask({ allowFailed: true });
  // The worker must continue dispatching outbox events when there are no HTTP requests.
  const require = createRequire(path.join(cliRoot, 'node_modules/@wxcloud/cli/package.json'));
  require('./lib/api/adapter').initCloudAPI(config.WXCLOUD_APP_ID || config.WECHAT_APP_ID);
  const { serviceBaseConfig: currentConfig } = await require('@wxcloud/core').CloudAPI.tcbDescribeServiceBaseConfig({ envId: config.WXCLOUD_ENV_ID, serverName: name });
  const currentEnv = JSON.parse(currentConfig.envParams || '{}');
  const configured = currentConfig.minNum === 1 && currentConfig.maxNum === 2 && currentConfig.cpu === 1 && currentConfig.mem === 2 &&
    Object.entries(envParams).every(([key,value]) => currentEnv[key] === value);
  if (!configured) {
    await runCli(['service:config', 'update', ...flags, '--serviceName', name,
      '--minNum', '1', '--maxNum', '2', '--cpu', '1', '--mem', '2', '--envParams', '',
      '--envParamsJson', JSON.stringify(envParams), '--noConfirm']);
    await waitTask();
  } else console.log('原服务配置已匹配，复用现有配置。');
  await runCli(['run:deploy', source, ...flags, '--serviceName', name,
    '--targetDir', '.', '--dockerfile', 'deploy/cloudrun/Dockerfile', '--containerPort', '8080',
    '--remark', 'Umeet API + admin + worker', '--noConfirm', '--detach']);
  await waitTask();
  const updated = await runCli(['service:list', ...flags, '--json'], { json: true });
  const deployed = updated.find((service) => service.ServerName === name);
  const domain = deployed?.DefaultPublicDomain;
  if (!domain || domain === '-') throw new Error('部署命令已完成，但没有公网域名，尚未通过外部健康检查');
  const base = domain.startsWith('https://') ? domain : `https://${domain}`;
  const response = await fetch(new URL('/api/v1/health', base), { signal: AbortSignal.timeout(20000) });
  const health = await response.json();
  if (!response.ok || health.status !== 'ok' || health.demo !== false)
    throw new Error('部署命令已完成，但外部生产健康检查未通过');
  console.log(`云托管部署及健康检查通过：${base}`);
  console.log('请运行 node scripts/wxcloud-smoke.mjs https://example.com 验证正式域名及微信登录依赖。');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
