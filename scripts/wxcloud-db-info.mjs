import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
const c = dotenv.parse(readFileSync('.env.wxcloud'));
const require = createRequire(path.join(process.env.LOCALAPPDATA, 'Umeet/wxcloud-cli/node_modules/@wxcloud/cli/package.json'));
require('./lib/api/common').setApiCommonParameters({ region: c.WXCLOUD_REGION });
try {
 const result = await require('./lib/api').DescribeWxCloudBaseRunDBClusterDetail({ EnvId: c.WXCLOUD_ENV_ID });
 function inspect(value, prefix='') {
   if (!value || typeof value !== 'object') return;
   for (const [key,v] of Object.entries(value)) {
     if (/version|status|engine/i.test(key) && typeof v !== 'object') console.log(prefix+key, v);
     if (v && typeof v === 'object' && !/secret|password|credential|envparam/i.test(key)) inspect(v,prefix+key+'.');
   }
 }
 inspect(result);
} catch { console.error('无法读取数据库版本信息'); process.exitCode=1; }
