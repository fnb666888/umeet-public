import {mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=resolve('.runtime/smtp-fixture');mkdirSync(dir,{recursive:true});
const openssl=process.env.OPENSSL_BIN||(process.platform==='win32'&&existsSync('D:/Git/Git/usr/bin/openssl.exe')?'D:/Git/Git/usr/bin/openssl.exe':'openssl');
const result=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',resolve(dir,'key.pem'),'-out',resolve(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE'],{stdio:'ignore'});
if(result.status!==0)throw new Error('TEST_CERTIFICATE_GENERATION_FAILED');
process.stdout.write('Generated one-day local SMTP test certificate; key remains in ignored runtime directory.\n');
