import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env')) {
  const password = randomBytes(24).toString('hex');
  let config = readFileSync('.env.example', 'utf8')
    .replace('umeet:CHANGE_ME@', `umeet:${password}@`)
    .replace('CHANGE_ME_GENERATE_WITH_NPM_RUN_SETUP', randomBytes(48).toString('hex'))
    .replace('CHANGE_ME_GENERATE_WITH_NPM_RUN_SETUP', randomBytes(24).toString('hex'));
  writeFileSync('.env', config);
  console.log('已创建 .env，本地密钥已随机生成。');
} else console.log('.env 已存在，保留现有配置。');
