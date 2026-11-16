import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  root = '../../apps/miniprogram/dist/';
const storage = new Map();
let respond;
globalThis.wx = {
  getStorageSync: (k) => storage.get(k),
  setStorageSync: (k, v) => storage.set(k, structuredClone(v)),
  removeStorageSync: (k) => storage.delete(k),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  request: (options) => respond(options),
  showToast: () => {},
  reLaunch: () => {},
  getAppBaseInfo: () => ({ theme: 'light' }),
  setNavigationBarColor: () => {},
  setTabBarStyle: () => {},
  removeTabBarBadge: () => {},
  disableAlertBeforeUnload: () => {},
  enableAlertBeforeUnload: () => {},
  redirectTo: () => {},
  env: { USER_DATA_PATH: '/local' },
};
const auth = require(root + 'utils/session.js'),
  { api } = require(root + 'utils/api.js');
const login = (id) =>
  auth.saveSession({ token: 'token-' + id, actor: { userId: id, kind: 'member' } });
beforeEach(() => {
  storage.clear();
  auth.clearSession();
  respond = (o) => o.success({ statusCode: 200, data: {} });
});
function page(name) {
  let definition;
  globalThis.Page = (d) => (definition = d);
  const path = require.resolve(root + name + '/index.js');
  delete require.cache[path];
  require(path);
  const p = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let object = this.data;
        for (const part of parts.slice(0, -1)) object = object[part] ??= {};
        object[parts.at(-1)] = value;
      }
    },
  };
  return p;
}
test('requests pin their originating account and discard a late response after login changes', async () => {
  login('alice');
  let pending;
  respond = (o) => (pending = o);
  const request = api('mobile/operations', 'POST', {});
  assert.equal(pending.header['X-Umeet-Account'], 'alice');
  login('bob');
  pending.success({ statusCode: 200, data: { private: 'alice' } });
  await assert.rejects(request, /账号已变化/);
  assert.equal(auth.session().actor.userId, 'bob');
});
test('an expired login is cleared and unrelated old account storage is never adopted', async () => {
  storage.set('token', 'legacy');
  storage.set('umeet_account_token', 'legacy-account');
  assert.equal(auth.session(), null);
  login('alice');
  respond = (o) => o.success({ statusCode: 401, data: { message: 'AUTH_REQUIRED' } });
  await assert.rejects(api('account'), /登录已过期/);
  assert.equal(auth.session(), null);
});
test('Wiki autosave preserves a failed private local draft and marks it unsynced', async () => {
  login('alice');
  const p = page('features/knowledge-editor');
  p._owner = 'alice';
  p._key = auth.draftKey('wiki', 'task');
  p.data.task = 'task';
  p.data.content = { ...p.data.content, title: '私人稿', markdown: '尚未同步的物理公式 $E=mc^2$' };
  respond = (o) => o.fail({ errMsg: 'offline' });
  await assert.rejects(p.flush(), /网络连接失败/);
  assert.equal(storage.get(p._key).unsynced, true);
  assert.match(p.data.status, /同步失败/);
  assert.equal(storage.get(p._key).content.title, '私人稿');
  login('bob');
  assert.notEqual(auth.draftKey('wiki', 'task'), p._key);
  await assert.rejects(p.flush(), /账号已变化/);
});
test('unchanged post retries use identical entity and idempotency identifiers', async () => {
  login('alice');
  const p = page('features/publish');
  p._owner = 'alice';
  p.data.key = auth.draftKey('post');
  p.data.title = 'Retry';
  p.data.body = 'Keep body';
  const sent = [];
  respond = (o) => {
    sent.push(o.data);
    o.fail({ errMsg: 'timeout' });
  };
  await p.submit();
  await p.submit();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(p.data.body, 'Keep body');
});

test('successful publishing cannot recreate a completed draft when leaving', async () => {
  login('alice');
  const p = page('features/publish');
  p._owner = 'alice';
  p.data.key = auth.draftKey('post');
  p.data.title = 'Done';
  p.data.body = 'Body';
  respond = (o) =>
    o.success({
      statusCode: 200,
      data: o.url.endsWith('bootstrap') ? { postReviews: [] } : { ok: true },
    });
  await p.submit();
  p.onHide();
  p.onUnload();
  assert.equal(storage.has(p.data.key), false);
  assert.equal(p._submitted, true);
});
test('a retained form cannot publish under a different account', async () => {
  login('alice');
  const p = page('features/publish');
  p._owner = 'alice';
  p.data.title = 'Private Alice';
  p.data.body = 'Private';
  login('bob');
  let sent = 0;
  respond = () => sent++;
  await p.submit();
  assert.equal(sent, 0);
  assert.match(p.data.error, /账号已变化/);
});
test('private draft restores before any read of its unpublished page', async () => {
  login('alice');
  const p = page('features/knowledge-editor');
  p.data.pageId = 'unpublished';
  p.data.task = 'task';
  let paths = [];
  respond = (o) => {
    paths.push(o.url);
    o.success({
      statusCode: 200,
      data: {
        draft: {
          pageId: 'unpublished',
          version: 2,
          content: { ...p.data.content, title: 'Private', markdown: 'Text' },
        },
      },
    });
  };
  await p.init();
  assert.equal(paths.length, 1);
  assert.equal(p.data.loaded, true);
  assert.equal(p.data.content.title, 'Private');
});
test('Wiki and post input cannot change while submission is in progress', () => {
  login('alice');
  for (const name of ['features/knowledge-editor', 'features/publish']) {
    const p = page(name);
    p.data.busy = true;
    p.input({
      currentTarget: { dataset: { field: 'title' } },
      detail: { value: 'Unexpected edit' },
    });
    assert.notEqual(p.data.title ?? p.data.content.title, 'Unexpected edit');
  }
});
test('message rows are cleared immediately when the account changes even if reload fails', async () => {
  login('alice');
  const p = page('pages/messages');
  p._owner = 'alice';
  p.data.items = [{ text: 'Private Alice' }];
  login('bob');
  respond = (o) => o.fail({ errMsg: 'offline' });
  p.onShow();
  assert.deepEqual(p.data.items, []);
  await new Promise((r) => setTimeout(r, 0));
  assert.match(p.data.error, /网络连接失败/);
});

test('restoring an edit draft retains the target post rather than creating a duplicate',()=>{login('alice');const p=page('features/publish');p.data.key=auth.draftKey('post','original');storage.set(p.data.key,{id:'original',title:'Edit draft',body:'Updated'});p.restore();assert.equal(p.data.id,'original');});
test('image-heavy post drafts persist outside storage and restore the complete input',()=>{login('alice');const files=new Map();wx.getFileSystemManager=()=>({mkdirSync(){},writeFileSync:(k,v)=>files.set(k,v),readFileSync:k=>files.get(k),unlinkSync:k=>files.delete(k)});const d=require(root+'utils/post-draft.js'),key=auth.draftKey('post');const value={id:'',title:'Images',body:'Keep',images:['data:image/png;base64,'+'x'.repeat(800000)]};d.savePostDraft(key,value);assert.ok(storage.get(key).filePath);assert.ok(JSON.stringify(storage.get(key)).length<1000);assert.deepEqual(d.readPostDraft(key),value);d.removePostDraft(key);assert.equal(files.size,0);assert.equal(storage.has(key),false);});
