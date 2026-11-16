import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import {afterEach,describe,expect,it} from 'vitest';
import request from 'supertest';
import {createTestApp,type TestApp} from './support/test-app.js';
let h:TestApp|undefined;afterEach(async()=>{await h?.close();h=undefined;});
describe('authenticated personal records HTTP',()=>{
 it('allows a guest to keep a long private draft, but never reads another account records',async()=>{
  h=await createTestApp();const server=h.app.getHttpServer();
  const guest=await request(server).post('/api/v1/auth/guest').send({});
  const other=await request(server).post('/api/v1/auth/guest').send({});
  const token='Bearer '+guest.body.token;
  expect((await request(server).put('/api/v1/records/draft/my-page').send({value:'不登录无法写入'})).status).toBe(401);
  const value='中文长草稿'.repeat(15000);
  expect((await request(server).put('/api/v1/records/draft/my-page').set('Authorization',token).send({value})).status).toBe(200);
  const mine=await request(server).get('/api/v1/records?kind=draft').set('Authorization',token);
  expect(mine.status).toBe(200);expect(mine.body.items[0].value).toBe(value);
  const theirs=await request(server).get('/api/v1/records?kind=draft').set('Authorization','Bearer '+other.body.token);
  expect(theirs.body.items).toEqual([]);
  expect((await request(server).get('/api/v1/records?userId='+guest.body.actor.userId).set('Authorization','Bearer '+other.body.token)).status).toBe(400);
  expect((await request(server).delete('/api/v1/records/draft/my-page').set('Authorization',token)).status).toBe(200);
  expect((await request(server).get('/api/v1/records?kind=draft').set('Authorization',token)).body.items).toEqual([]);
 });
 it('makes saved guest data available after registering the same session',async()=>{
  h=await createTestApp();const server=h.app.getHttpServer();
  const guest=await request(server).post('/api/v1/auth/guest').send({});
  await request(server).put('/api/v1/records/bookmark/wiki-one').set('Authorization','Bearer '+guest.body.token).send({value:'收藏的词条'}).expect(200);
  const member={body:await new PasswordAuthService(h.db).register({username:'record_owner',password:'A Secure Password 42!',guestToken:guest.body.token},'records')};
  const records=await request(server).get('/api/v1/records?kind=bookmark').set('Authorization','Bearer '+member.body.token).expect(200);
  expect(records.body.items[0].value).toBe('收藏的词条');
  await request(server).get('/api/v1/records').set('Authorization','Bearer '+guest.body.token).expect(401);
 });
});
