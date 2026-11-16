import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCname, resolve4 } from 'node:dns/promises';
import dotenv from 'dotenv';

const config = dotenv.parse(readFileSync('.env.wxcloud'));
const require = createRequire(path.join(process.env.LOCALAPPDATA, 'Umeet/wxcloud-cli/node_modules/@wxcloud/cli/package.json'));
require('./lib/api/common').setApiCommonParameters({ region: config.WXCLOUD_REGION });
const api = require('./lib/api');
const opts = { EnvId: config.WXCLOUD_ENV_ID };
const results = await Promise.allSettled([
  api.DescribeCloudBaseRunServiceDomain({ ...opts, ServiceName: config.WXCLOUD_SERVICE_NAME }),
  api.DescribeCustomDomains(opts),
  resolveCname('example.com'),
  resolve4('example.com'),
]);
const names = ['serviceDomain', 'domainBindings', 'dnsCname', 'dnsA'];
for (let i = 0; i < results.length; i++) {
  const result = results[i];
  if (result.status === 'rejected') {
    // Do not expose provider error payloads or authentication details.
    console.log(JSON.stringify({ check: names[i], status: 'unavailable', ...(i >= 2 ? { code: result.reason?.code } : {}) }));
    continue;
  }
  const value = result.value;
  let data;
  if (i === 0) data = { publicDomain: value.DefaultPublicDomain, access: value.AccessTypes };
  else if (i === 1) {
    const domains = value.DomainList || value.domainList;
    data = domains ? domains.map(d => ({ domain: d.Domain || d.domain, service: d.ServiceName || d.serviceName, protocol: d.Protocol || d.protocol, cname: d.Cname || d.cname, status: d.Status || d.status })) : { status: 'provider returned no domain list; verify with HTTPS health check' };
  }
  else data = value;
  console.log(JSON.stringify({ check: names[i], data }));
}
