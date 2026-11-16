import { afterEach, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
it('projects website posts with pagination, isolated private state and shared writes', async () => {
  h = await createTestApp();
  const api = request(h.app.getHttpServer()),
    auth = new PasswordAuthService(h.db);
  const a = await auth.register(
    { username: 'mini_author', password: 'Mobile integration 88!' },
    'mini-a',
  );
  const b = await auth.register(
    { username: 'mini_reader', password: 'Mobile integration 88!' },
    'mini-b',
  );
  const send = (token: string, operations: object[]) =>
    api
      .post('/api/v1/mobile/operations')
      .auth(token, { type: 'bearer' })
      .send({ id: randomUUID(), operations });
  for (let i = 0; i < 3; i++)
    await send(a.token, [
      {
        type: 'post.create',
        post: { id: 'mini-' + i, community: 'daily', title: 'Mobile ' + i, body: 'shared' },
      },
    ]).expect(201);
  const first = (await api.get('/api/v1/mobile/feed?limit=2').expect(200)).body;
  expect(first.items).toHaveLength(2);
  expect(first.next).toBeTruthy();
  expect(first.content).toBeUndefined();
  const rest = (
    await api
      .get('/api/v1/mobile/feed?limit=2&cursor=' + encodeURIComponent(first.next))
      .expect(200)
  ).body;
  expect(rest.items).toHaveLength(1);
  expect(new Set([...first.items, ...rest.items].map((p) => p.id)).size).toBe(3);
  await send(b.token, [{ type: 'state.save', state: { bookmarks: ['mini-0'] } }]).expect(201);
  expect(
    (await api.get('/api/v1/mobile/feed?view=bookmarks').auth(a.token, { type: 'bearer' })).body
      .items,
  ).toEqual([]);
  expect(
    (await api.get('/api/v1/mobile/feed?view=bookmarks').auth(b.token, { type: 'bearer' })).body
      .items,
  ).toHaveLength(1);
  await send(b.token, [{ type: 'post.edit', postId: 'mini-0', title: 'forged', body: 'x' }]).expect(
    403,
  );
  expect((await api.get('/api/v1/demo').expect(200)).body.content.posts).toHaveLength(3);
  const longBody='# Full website article\n\n'+'Long content. '.repeat(240);
  const edit={id:randomUUID(),title:'Edited full article',markdown:longBody};
  await api.post('/api/v1/mobile/posts/mini-0/edit').auth(a.token,{type:'bearer'}).send(edit).expect(201);
  await api.post('/api/v1/mobile/posts/mini-0/edit').auth(a.token,{type:'bearer'}).send(edit).expect(201);
  const edited=(await api.get('/api/v1/mobile/posts/mini-0').auth(a.token,{type:'bearer'})).body.post;
  expect(edited.html).toContain('Long content.');expect(edited.editMarkdown.length).toBeGreaterThan(2000);
  await api.post('/api/v1/mobile/posts/mini-0/edit').auth(b.token,{type:'bearer'}).send({...edit,id:randomUUID()}).expect(403);
  await send(a.token,[{type:'state.save',state:{privacyPrefs:{profilePublic:false,marksPublic:false}}}]).expect(201);
  const privateProfile=(await api.get('/api/v1/mobile/profiles/'+a.actor.userId)).body;
  expect(privateProfile.public).toBe(false);expect(privateProfile.profile).toBeNull();
  await h.db.insertInto('admin_visibility').values({ target: 'post:mini-0', hidden: 1 }).execute();
  await api.get('/api/v1/mobile/posts/mini-0').expect(404);
  await api.get('/api/v1/mobile/feed?limit=500').expect(400);
  await send(a.token, [{ type: 'wiki.note', wikiId: 'x', text: 'x' }]).expect(400);
});
