import {afterEach,describe,it,expect} from 'vitest';
import {createTestApp,type TestApp} from './support/test-app.js';
import {JobsService} from '../src/modules/jobs/jobs.service.js';
let h:TestApp|undefined;afterEach(async()=>{await h?.close();h=undefined;});
describe('durable MySQL jobs',()=>{
 it('deduplicates business keys and permits only one active lease',async()=>{
  h=await createTestApp();const jobs=new JobsService(h.db),now=new Date();
  await h.db.transaction().execute(async tx=>{await jobs.enqueue(tx,{kind:'test',key:'same',payload:{id:'1'}},now);await jobs.enqueue(tx,{kind:'test',key:'same',payload:{id:'1'}},now);});
  expect((await h.db.selectFrom('jobs').select('available_at').executeTakeFirstOrThrow()).available_at.getTime()).toBe(now.getTime());
  const leases=await Promise.all([jobs.claim('a',now),jobs.claim('b',now)]);
  expect(leases.filter(Boolean)).toHaveLength(1);
  expect(await h.db.selectFrom('jobs').selectAll().execute()).toHaveLength(1);
 });
 it('reclaims expired leases and rejects stale acknowledgements',async()=>{
  h=await createTestApp();const jobs=new JobsService(h.db),now=new Date();
  await h.db.transaction().execute(tx=>jobs.enqueue(tx,{kind:'test',key:'expire',payload:{}},now));
  const old=await jobs.claim('a',now);if(!old)throw new Error('missing lease');
  const replacement=await jobs.claim('b',new Date(now.getTime()+61000));if(!replacement)throw new Error('missing new lease');
  expect(replacement.leaseToken).not.toBe(old.leaseToken);
  await expect(jobs.complete(old)).rejects.toThrow('STALE_LEASE');
  await jobs.complete(replacement);
  expect(await jobs.claim('c',new Date(now.getTime()+62000))).toBeNull();
 });
 it('rolls back pending events with the business transaction',async()=>{
  h=await createTestApp();const jobs=new JobsService(h.db);
  await expect(h.db.transaction().execute(async tx=>{await jobs.enqueue(tx,{kind:'test',key:'rollback',payload:{}},new Date());throw new Error('rollback');})).rejects.toThrow('rollback');
  expect(await h.db.selectFrom('jobs').selectAll().execute()).toHaveLength(0);
 });
});
