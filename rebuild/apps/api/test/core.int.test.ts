import { afterEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app.js';
let harness:TestApp|undefined;
afterEach(async()=>{await harness?.close();harness=undefined;});
describe('real MySQL API foundation',()=>{
  it('reports dependency readiness without exposing credentials',async()=>{
    harness=await createTestApp();
    const live=await request(harness.app.getHttpServer()).get('/api/v1/health');
    expect(live.status).toBe(200);
    const ready=await request(harness.app.getHttpServer()).get('/api/v1/ready');
    expect(ready.status).toBe(200);
    expect(JSON.stringify(ready.body)).not.toMatch(/mysql:\/\/|password|19316/);
  });
  it('rolls back a failed real database transaction',async()=>{
    harness=await createTestApp();
    const db=harness.db;
    await expect(db.transaction().execute(async tx=>{
      await tx.insertInto('users').values({id:'rollback-user',nickname:'事务'}).execute();
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await db.selectFrom('users').selectAll().where('id','=','rollback-user').execute()).toHaveLength(0);
  });
  it('can rerun migrations without duplicating the schema',async()=>{
    harness=await createTestApp();
    const {migrate}=await import('../src/database/migrate.js');
    await migrate(harness.db);
    await harness.db.insertInto('users').values({id:'repeat-migration',nickname:'幂等迁移'}).execute();
    expect((await harness.db.selectFrom('users').selectAll().where('id','=','repeat-migration').executeTakeFirst())?.nickname).toBe('幂等迁移');
  });
});
