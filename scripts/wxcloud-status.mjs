import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
const root = process.cwd();
const c = dotenv.parse(readFileSync(path.join(root, '.env.wxcloud')));
const home = path.join(process.env.LOCALAPPDATA, 'Umeet/wxcloud-cli/node_modules/@wxcloud/cli');
const require = createRequire(path.join(home, 'package.json'));
const api = require('./lib/api');
require('./lib/api/common').setApiCommonParameters({ region: c.WXCLOUD_REGION });
function safe(value) {
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  for (const v of Object.values(c).filter(v => v.length >= 8).sort((a,b)=>b.length-a.length))
    for (const part of [v, encodeURIComponent(v), JSON.stringify(v).slice(1,-1)]) s = s.split(part).join('[redacted]');
  return s.replace(/mysql:\/\/[^\s"']+/gi, '[mysql-url-redacted]');
}
try {
  const taskResult = await api.DescribeServerManageTask({ EnvId: c.WXCLOUD_ENV_ID, ServerName: c.WXCLOUD_SERVICE_NAME });
  const task = taskResult.Task;
  console.log(safe({ taskId: task?.Id, status: task?.Status, version: task?.VersionName, steps: task?.Steps, reason: task?.FailReason }));
  const versions = await api.DescribeCloudBaseRunServer({ EnvId: c.WXCLOUD_ENV_ID, ServerName: c.WXCLOUD_SERVICE_NAME, Offset: 0, Limit: 2 });
  const rows = versions.VersionItems || versions.versionItems || [];
  console.log(JSON.stringify(rows.map(v => Object.fromEntries(Object.entries(v).filter(([k]) => /versionname|status|buildid|runid|createtime|failreason|flowratio/i.test(k))))));
  if (process.argv.includes('--pods')) {
    require('./lib/api/adapter').initCloudAPI(c.WXCLOUD_APP_ID || c.WECHAT_APP_ID);
    const pods = await require('@wxcloud/core').CloudAPI.tcbDescribeCloudBaseRunPodList({ envId: c.WXCLOUD_ENV_ID, serverName: c.WXCLOUD_SERVICE_NAME, versionName: task.VersionName, limit: 10 });
    console.log(JSON.stringify(pods.podList?.map(pod => ({ id: pod.podId, status: pod.status, createdAt: pod.createTime }))));
  }
  if (process.argv.includes('--logs')) {
    const current = rows.find(row => row.VersionName === task?.VersionName) || rows.at(-1);
    const normalized = Object.fromEntries(Object.entries(current || {}).map(([key,value])=>[key[0].toLowerCase()+key.slice(1),value]));
    const result = await require('./lib/utils/run').computedBuildLog(c.WXCLOUD_ENV_ID, normalized);
    mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    const log = path.join(root, 'artifacts/wxcloud-build.redacted.log');
    writeFileSync(log, safe(result));
    console.log(safe(result).slice(-18000));
  }
} catch (error) { console.error(safe(error.message)); process.exitCode = 1; }
