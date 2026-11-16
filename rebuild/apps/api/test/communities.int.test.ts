import {afterEach,describe,it,expect} from 'vitest';
import {createTestApp,type TestApp} from './support/test-app.js';
import {IdentityService} from '../src/modules/identity/identity.service.js';
import {CommunitiesService} from '../src/modules/communities/communities.service.js';
let h:TestApp|undefined;afterEach(async()=>{await h?.close();h=undefined;});
describe('community lifecycle',()=>{
 it('preserves six permanent communities and adds opt-in content and interest communities idempotently',async()=>{
  h=await createTestApp();const service=new CommunitiesService(h.db);await service.seedDefaults();await service.seedDefaults();
  const communities=await service.list();
  expect(communities.filter(c=>c.is_default===1).map(c=>c.name)).toEqual(['树洞','交易','资源','问答','搭子与活动','校园日常']);
  expect(communities.filter(c=>c.is_default===0).map(c=>c.name)).toEqual(['资讯','预测','AI','科技','开源','Web3 技术']);
  expect(await h.db.selectFrom('wiki_spaces').selectAll().execute()).toHaveLength(12);
 });
 it('rejects guest applications and creates a community only after platform approval',async()=>{
  h=await createTestApp();const identities=new IdentityService(h.db),s=new CommunitiesService(h.db);
  const guest=await identities.resolve({provider:'test',subject:'guest',kind:'guest'});
  const owner=await identities.resolve({provider:'test',subject:'member',kind:'member'});
  await expect(s.apply({actor:guest,requestId:'g'},{name:'天文',slug:'astronomy',description:'一起观星'})).rejects.toThrow('REGISTERED_ACCOUNT_REQUIRED');
  const app=await s.apply({actor:owner,requestId:'m'},{name:'天文',slug:'astronomy',description:'一起观星'});
  await expect(s.approve({actor:owner,requestId:'m'},app.id)).rejects.toThrow('PLATFORM_PERMISSION_REQUIRED');
  const admin={...owner,platformRoles:['owner']};
  const c=await s.approve({actor:admin,requestId:'a'},app.id);
  expect((await s.approve({actor:admin,requestId:'a'},app.id)).id).toBe(c.id);
  expect(await s.hasRole(owner.userId,c.id,'owner')).toBe(true);
 });
 it('requires invitation acceptance and never confers permissions in another community',async()=>{
  h=await createTestApp();const identities=new IdentityService(h.db),s=new CommunitiesService(h.db);
  const owner=await identities.resolve({provider:'test',subject:'owner',kind:'member'});
  const invited=await identities.resolve({provider:'test',subject:'invited',kind:'member'});
  const other=await identities.resolve({provider:'test',subject:'other',kind:'member'});
  const application=await s.apply({actor:owner,requestId:'1'},{name:'天文',slug:'astronomy',description:'观星'});
  const c=await s.approve({actor:{...owner,platformRoles:['owner']},requestId:'2'},application.id);
  const invite=await s.invite({actor:owner,requestId:'3'},c.id,invited.userId);
  expect(await s.hasRole(invited.userId,c.id,'moderator')).toBe(false);
  await expect(s.accept({actor:other,requestId:'4'},invite.id)).rejects.toThrow('INVITATION_NOT_YOURS');
  await s.accept({actor:invited,requestId:'5'},invite.id);
  expect(await s.hasRole(invited.userId,c.id,'moderator')).toBe(true);
  expect(await s.hasRole(invited.userId,'another-community','moderator')).toBe(false);
 });
});
