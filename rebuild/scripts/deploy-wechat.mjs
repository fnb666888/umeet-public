import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstatSync, mkdirSync, readdirSync, readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
if (!['api', 'web'].includes(target)) throw new Error('Usage: node scripts/deploy-wechat.mjs api|web');
const required = ['WXCLOUD_CLI_PATH', 'WXCLOUD_APP_ID', 'WXCLOUD_CLI_KEY', 'WXCLOUD_ENV_ID',
  target === 'api' ? 'WXCLOUD_API_SERVICE' : 'WXCLOUD_WEB_SERVICE',
  target === 'api' ? 'WXCLOUD_API_ORIGIN' : 'PUBLIC_WEB_ORIGIN'];
for (const key of required) if (!process.env[key]) throw new Error('Missing ' + key);
const cli = path.resolve(process.env.WXCLOUD_CLI_PATH);
const cliRequire = createRequire(path.resolve(cli, '../../package.json'));
const region = process.env.WXCLOUD_REGION || 'ap-shanghai';
const envId = process.env.WXCLOUD_ENV_ID;
const serviceName = process.env[target === 'api' ? 'WXCLOUD_API_SERVICE' : 'WXCLOUD_WEB_SERVICE'];
const secret = process.env.WXCLOUD_CLI_KEY;
const redact = (value) => String(value).split(secret).join('[redacted]')
  .split(JSON.stringify(secret).slice(1, -1)).join('[redacted]');
const flags = ['--envId', envId, '--region', region];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCli(args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root, env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (data) => { output = (output + data).slice(-4 * 1024 * 1024); });
    child.stderr.on('data', (data) => { output = (output + data).slice(-4 * 1024 * 1024); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
  if (result.code !== 0) {
    // CLI confirmation tables can contain credentials. Only surface diagnostic lines.
    const diagnostic = redact(result.output).split(/\r?\n/)
      .filter((line) => /error|失败|错误|尚未登录/i.test(line)).slice(-8).join('\n');
    throw new Error('WeChat CLI ' + args[0] + ' failed. ' + diagnostic);
  }
  return result.output;
}

function stageSource() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'umeet-' + target + '-'));
  const excluded = new Set(['node_modules', 'dist', '.next', 'test', 'tests', 'coverage',
    '.git', '.runtime', '.superpowers']);
  function copy(relative, destination = relative) {
    const source = path.join(root, relative);
    const targetPath = path.join(directory, destination);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error('Deployment source contains a symlink');
    if (stat.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      for (const name of readdirSync(source)) {
        if (excluded.has(name) || name.startsWith('.env') || name === 'AGENTS.md' ||
          /\.(key|pem|log|tsbuildinfo)$/.test(name)) continue;
        copy(path.join(relative, name), path.join(destination, name));
      }
    } else {
      if (readFileSync(source).includes(Buffer.from(secret))) throw new Error('CLI key found in source');
      mkdirSync(path.dirname(targetPath), { recursive: true });
      copyFileSync(source, targetPath);
    }
  }
  for (const relative of ['package.json', 'package-lock.json', 'tsconfig.json', 'packages',
    'apps/api/package.json', 'apps/web/package.json', '.dockerignore']) copy(relative);
  const files = target === 'api'
    ? ['apps/api/src', 'apps/api/tsconfig.json', 'cloud-start.mjs']
    : ['apps/web/src', 'apps/web/public', 'apps/web/tsconfig.json',
      'apps/web/next.config.ts', 'apps/web/next-env.d.ts'];
  for (const relative of files) copy(relative);
  copy('Dockerfile.' + target, 'Dockerfile');
  console.log('Prepared ' + target + ' source package');
  return directory;
}

async function waitForRelease(api, previousTaskId) {
  const deadline = Date.now() + 20 * 60000;
  let previous = '';
  while (Date.now() < deadline) {
    const { Task: task } = await api.DescribeServerManageTask({ EnvId: envId, ServerName: serviceName });
    if (task && task.Id !== previousTaskId) {
      const status = task.VersionName + ' ' + task.Status + ' ' +
        task.Steps.filter((step) => step.Status === 'running').map((step) => step.Name).join(', ');
      if (status !== previous) { console.log(status); previous = status; }
      if (task.Status === 'failed' || task.FailReason || task.Steps.some((step) => step.Status === 'failed'))
        throw new Error('Cloud deployment failed. Inspect WeChat hosting build logs for ' + task.VersionName);
      if (task.Status === 'finished') {
        const result = await api.DescribeCloudBaseRunServer({
          EnvId: envId, ServerName: serviceName, Offset: 0, Limit: 100,
        });
        const version = result.VersionItems?.find((item) => item.VersionName === task.VersionName);
        if (version?.Status === 'normal' && version.FlowRatio === 100) return task.VersionName;
      }
    }
    await pause(15000);
  }
  throw new Error('Deployment timed out. Check the existing task before submitting another release');
}

async function verifyHealth() {
  const origin = process.env[target === 'api' ? 'WXCLOUD_API_ORIGIN' : 'PUBLIC_WEB_ORIGIN'];
  const endpoint = new URL(target === 'api' ? '/api/v1/health' : '/', origin);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(60000), cache: 'no-store' });
      if (response.ok && (target === 'web' || (await response.json()).status === 'ok')) {
        console.log('Production health check passed for ' + target);
        return;
      }
    } catch (error) { console.log('Health check retry. ' + redact(error.message)); }
    await pause(10000);
  }
  throw new Error('Production health check failed for ' + target);
}

async function main() {
  await runCli(['login', '--appId', process.env.WXCLOUD_APP_ID, '--privateKey', secret]);
  cliRequire('./lib/api/common').setApiCommonParameters({ region });
  const api = cliRequire('./lib/api');
  const { Task: current } = await api.DescribeServerManageTask({ EnvId: envId, ServerName: serviceName });
  if (current && !['finished', 'failed'].includes(current.Status))
    throw new Error('A deployment is already running for ' + serviceName);
  const source = stageSource();
  await runCli(['run:deploy', source, ...flags, '--serviceName', serviceName,
    '--targetDir', '.', '--dockerfile', 'Dockerfile', '--containerPort', '8080',
    '--remark', 'GitHub ' + (process.env.GITHUB_SHA || 'manual').slice(0, 12), '--noConfirm', '--detach']);
  const version = await waitForRelease(api, current?.Id);
  await verifyHealth();
  console.log('Released ' + version + ' with 100% traffic');
}
main().catch((error) => { console.error(redact(error.message)); process.exitCode = 1; });
