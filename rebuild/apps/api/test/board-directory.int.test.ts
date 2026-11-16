import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
import { CommunitiesService } from '../src/modules/communities/communities.service.js';
import { DemoSnapshotsService } from '../src/modules/demo/demo-snapshots.service.js';
import { moderationAccess, requireScope } from '../src/modules/admin/scope.js';
import { SiteSettingsSchema } from '../../../packages/contracts/src/site-settings.js';
import { defaultSiteSettings } from '../../../packages/contracts/src/site-settings-defaults.js';
import { randomUUID } from 'node:crypto';

let h: TestApp | undefined;
afterEach(async () => { await h?.close(); h = undefined; });

it('uses a seventh board in posting, following and authorization while rejecting unknown boards', async () => {
  h = await createTestApp();
  await new CommunitiesService(h.db).seedDefaults();
  await h.db.insertInto('communities').values({id:'astronomy',slug:'astronomy',name:'天文',description:'观星'}).execute();
  const actor = await new IdentityService(h.db).resolve({provider:'test',subject:'board-directory',kind:'member'});
  await h.db.insertInto('platform_roles').values({user_id:actor.userId,role:'admin'}).execute();
  const service = new DemoSnapshotsService(h.db);
  await service.save(actor.userId, {id:randomUUID(),operations:[
    {type:'post.create',post:{id:'new-board-post',community:'astronomy',title:'观星',body:'一起看星星'}},
    {type:'state.save',state:{followedBoards:['astronomy']}},
  ]});
  const snapshot = await service.get(actor.userId);
  expect(snapshot.boards.map(board=>board.slug)).toContain('astronomy');
  expect(snapshot.content.posts[0]?.community).toBe('astronomy');
  expect((await moderationAccess(h.db, actor.userId)).boards.map(board=>board.board)).toContain('astronomy');
  await expect(requireScope(h.db, actor.userId, 'unknown-board')).rejects.toThrow('UNKNOWN_BOARD');
  await expect(service.save(actor.userId,{id:randomUUID(),operations:[{type:'post.create',post:{id:'bad-post',community:'unknown-board',title:'bad',body:''}}]})).rejects.toThrow('UNKNOWN_BOARD');
  const settings = structuredClone(defaultSiteSettings);
  const extended = {...settings,boards:{...settings.boards,astronomy:settings.boards.daily}};
  expect(SiteSettingsSchema.parse(extended).boards['astronomy']).toBeDefined();
});
