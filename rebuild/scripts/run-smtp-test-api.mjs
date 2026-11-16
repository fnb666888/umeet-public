/** Starts the normal API against loopback DB + SMTP sink; no auth bypass or real provider. */
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
const url=new URL(process.env.DATABASE_URL||'mysql://root@127.0.0.1:19316/umeet_rebuild_local');
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/umeet_rebuild_local')throw new Error('UNSAFE_SMTP_TEST_DATABASE');
const cert=resolve('.runtime/smtp-fixture/cert.pem');if(!existsSync(cert))throw new Error('PREPARE_SMTP_FIXTURE_FIRST');
const child=spawn(process.execPath,['--import','tsx','apps/api/src/main.ts'],{stdio:'inherit',env:{...process.env,DATABASE_URL:url.href,PORT:'3188',HOST:'127.0.0.1',EMAIL_OTP_ENABLED:'true',SMS_OTP_PROVIDER:'disabled',OTP_HASH_KEY:randomBytes(32).toString('hex'),OTP_EMAIL_DAILY_LIMIT:'200',WECHAT_MINI_APP_ID:'',WECHAT_MINI_APP_SECRET:'',WECHAT_OPEN_PLATFORM_REALM:'',SMTP_HOST:'localhost',SMTP_PORT:'2465',SMTP_SECURITY:'tls',SMTP_USER:'test-sender',SMTP_PASSWORD:'local-test-password',SMTP_FROM:'sender@fixture.invalid',NODE_EXTRA_CA_CERTS:cert,NODE_TLS_REJECT_UNAUTHORIZED:'1'}});
child.once('exit',code=>{process.exitCode=code??1;});
process.once('SIGINT',()=>child.kill('SIGINT'));process.once('SIGTERM',()=>child.kill('SIGTERM'));
