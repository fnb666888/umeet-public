// Official @wxcloud/cli, strictly service:list. No cloud mutations or deploys.
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const legacy=path.resolve(process.cwd(),'..');
const requireLegacy=createRequire(path.join(legacy,'package.json'));
const {parse}=requireLegacy('dotenv');
const config=parse(readFileSync(path.join(legacy,'.env.wxcloud')));
const cli=path.join(process.env.LOCALAPPDATA||'','Umeet','wxcloud-cli','node_modules','@wxcloud','cli','bin','run');
if(!existsSync(cli))throw new Error('WECHAT_HOSTING_CLI_NOT_FOUND');
const envId=config.WXCLOUD_ENV_ID;
if(!envId)throw new Error('WECHAT_HOSTING_ENV_NOT_CONFIGURED');
const result=spawnSync(process.execPath,[cli,'service:list','--envId',envId,'--region',config.WXCLOUD_REGION||'ap-shanghai','--json'],{cwd:legacy,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024});
const secrets=Object.entries(config).filter(([key])=>/secret|password|token|key|database_url/i.test(key)).map(([,value])=>value).filter(value=>value.length>3);
function safeString(input){let value=String(input);for(const secret of secrets)value=value.split(secret).join('[redacted]');return value;}
let data;
for(const line of (result.stdout||'').split(/\r?\n/).reverse()){
 try{const candidate=JSON.parse(line);if(candidate&&typeof candidate==='object'&&'code'in candidate){data=candidate;break;}}catch{ /* CLI also writes non-JSON status lines; only consume a valid envelope. */ }
}
if(result.status!==0||!data||data.code!==0){
 console.log(JSON.stringify({product:'微信云托管',operation:'service:list',status:'blocked',exitCode:result.status,code:data?.code??null,message:safeString(data?.message||data?.msg||result.error?.message||'CLI did not return a successful JSON envelope')}));process.exitCode=1;
}else{
 const fields=new Set(['ServerName','serverName','Status','status','Alias','alias','EnvId','envId','Region','region','Cpu','cpu','Mem','mem','MinNum','minNum','MaxNum','maxNum','Total','total']);
 function metadata(value){
  if(Array.isArray(value))return value.map(metadata);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).flatMap(([key,val])=>{
   if(fields.has(key))return [[key,typeof val==='string'?safeString(val):val]];
   if(val&&typeof val==='object')return [[key,metadata(val)]];
   return [];
  }));
  return null;
 }
 console.log(JSON.stringify({product:'微信云托管',operation:'service:list',status:'verified',data:metadata(data.data)},null,2));
}
