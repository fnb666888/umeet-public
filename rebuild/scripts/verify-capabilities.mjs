import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const arg=process.argv[2];
if(arg==='--local'){
 const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','probes/editor'],{stdio:'inherit'});
 process.exit(r.status??1);
}
const report=JSON.parse(readFileSync(new URL('../docs/decisions/capabilities.json',import.meta.url),'utf8'));
const required=['web-editor-markdown-roundtrip','mysql-test-runtime','wechat-cloud-hosting-environment','self-owned-auth-channels','mini-program-visual-editor','storage-and-file-checks','cloud-price-and-backup'];
if(!Array.isArray(report.results)||required.some(k=>!report.results.some(r=>r.capability===k&&['pass','blocked'].includes(r.status)&&r.evidence&&r.constraint))){
 throw new Error('INCOMPLETE_CAPABILITY_REPORT');
}
for(const r of report.results)console.log(`${r.status.toUpperCase()} ${r.capability}: ${r.evidence}`);
console.log('Report is structurally complete. BLOCKED entries remain incomplete capabilities, not release passes.');
if(arg==='--release'&&report.results.some(r=>r.status!=='pass'))process.exitCode=1;
