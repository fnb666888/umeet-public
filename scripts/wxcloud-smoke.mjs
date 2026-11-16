import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
const config = dotenv.parse(readFileSync('.env.wxcloud'));
const base = process.argv[2] || 'https://api.example.com';
const url = new URL(base);
const authorizedHosts = ['example-api-9-1504245566.sh.run.tcloudbase.com', 'example.com'];
if (url.protocol !== 'https:' || !authorizedHosts.includes(url.hostname) || url.port || url.username || url.password)
  throw new Error('Smoke test only sends credentials to the authorized service domain');
let token, mediaId;
async function call(route, options = {}) {
  return fetch(new URL('/api/v1' + route, url), { ...options, signal: AbortSignal.timeout(25000) });
}
function expect(condition, name) { if (!condition) throw new Error(name + ' failed'); console.log(name + ' passed'); }
try {
  const health = await call('/health');
  const info = await health.json();
  expect(health.ok && info.status === 'ok' && info.demo === false && info.name === 'Umeet', 'Production health and database');
  expect((await fetch(url, { signal: AbortSignal.timeout(15000) })).ok, 'Admin frontend');
  const invalidLogin = await call('/auth/wechat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'umeet-connectivity-invalid-code' }),
  });
  expect(invalidLogin.status === 401, 'WeChat upstream reachable and invalid code rejected');
  const login = await call('/auth/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: config.ADMIN_PASSWORD }) });
  const session = await login.json();
  expect(login.ok && typeof session.token === 'string', 'Admin login');
  token = session.token;
  const headers = { Authorization: 'Bearer ' + token };
  expect((await call('/admin/jobs', { headers })).ok, 'Authenticated task endpoint');
  expect((await call('/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'student' }) })).status === 403, 'Demo login disabled');
  const form = new FormData();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Pz8AAAAASUVORK5CYII=','base64');
  form.append('file', new Blob([png], { type: 'image/png' }), 'deployment-check.png');
  const uploaded = await call('/media?purpose=VERIFICATION', { method: 'POST', headers, body: form });
  const record = await uploaded.json();
  expect(uploaded.ok && typeof record.id === 'string', 'Private COS upload');
  mediaId = record.id;
  expect((await call('/media/' + mediaId)).status === 403, 'Anonymous media access denied');
  const file = await call('/media/' + mediaId, { headers });
  expect(file.ok && Buffer.from(await file.arrayBuffer()).equals(png), 'Authorized COS download');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (mediaId && token) {
    const deleted = await call('/media/' + mediaId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }).catch(() => null);
    if (!deleted?.ok) { console.error('Smoke test file cleanup failed'); process.exitCode = 1; }
    else console.log('Smoke test file cleanup passed');
  }
}
