import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { CommunitiesService } from '../src/modules/communities/communities.service.js';
import { createTestApp } from './support/test-app.js';

it('publishes discussions across the site immediately and restricts takedowns to community moderators', async () => {
  const h = await createTestApp();
  try {
    await new CommunitiesService(h.db).seedDefaults();
    const client = request(h.app.getHttpServer());
    const route = '/api/v1/discussions';
    async function register(username: string) {
      return new PasswordAuthService(h.db).register(
        { username, password: 'Test password 529!' },
        username,
      );
    }
    const author = await register('discussion_author');
    const reader = await register('discussion_reader');
    const moderator = await register('discussion_moderator');
    const guest = (await client.post('/api/v1/auth/guest').send({}).expect(201)).body;
    const campus = await h.db
      .selectFrom('communities')
      .select('id')
      .where('slug', '=', 'campus')
      .executeTakeFirstOrThrow();
    await h.db
      .updateTable('moderation_groups')
      .set({ boards: JSON.stringify(['daily']) })
      .where('name', '=', '版主')
      .execute();
    const group = await h.db
      .selectFrom('moderation_groups')
      .select('id')
      .where('name', '=', '版主')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('moderation_group_members')
      .values({
        group_id: group.id,
        user_id: moderator.actor.userId,
        boards: JSON.stringify(['daily']),
      })
      .execute();
    const post = {
      id: randomUUID(),
      community: 'campus',
      title: '实验室怎么预约',
      body: '周末还能预约吗？',
    };
    const other = { ...post, id: randomUUID(), community: 'questions' };
    await client.post(route).send(post).expect(401);
    await client.post(route).auth(guest.token, { type: 'bearer' }).send(post).expect(403);
    await client.post(route).auth(author.token, { type: 'bearer' }).send(post).expect(201);
    await client.post(route).auth(author.token, { type: 'bearer' }).send(post).expect(201);
    await client.post(route).auth(author.token, { type: 'bearer' }).send(other).expect(201);
    await client.get(route + '/' + post.id).expect(200);
    await client
      .get(route + '/review')
      .auth(reader.token, { type: 'bearer' })
      .expect(403);
    const review = (id: string, kind: string, decision = 'hide') =>
      client
        .post(route + '/review/' + id)
        .auth(moderator.token, { type: 'bearer' })
        .send({ kind, decision, reason: '测试审核' });
    const queue = await client
      .get(route + '/review')
      .auth(moderator.token, { type: 'bearer' })
      .expect(200);
    expect(queue.body.posts.map((item: { id: string }) => item.id)).toEqual([]);
    await review(other.id, 'post').expect(403);
    for (const query of ['', '?community=campus']) {
      const feed = (await client.get(route + query).expect(200)).body.items;
      expect(feed.map((item: { id: string }) => item.id)).toEqual(
        query ? [post.id] : [other.id, post.id],
      );
      expect(feed[0]).not.toHaveProperty('authorId');
    }
    expect((await client.get(route + '?community=questions').expect(200)).body.items).toHaveLength(
      1,
    );
    const comment = { id: randomUUID(), parentId: null, body: '可以，先联系值班同学。' };
    const reply = { id: randomUUID(), parentId: comment.id, body: '谢谢，我去试试。' };
    const commentTo = (data: typeof comment | typeof reply) =>
      client
        .post(route + '/' + post.id + '/comments')
        .auth(reader.token, { type: 'bearer' })
        .send(data);
    await commentTo(comment).expect(201);
    await commentTo(reply).expect(201);
    expect((await client.get(route + '/' + post.id).expect(200)).body.comments).toHaveLength(2);
    const vote = (value: number) =>
      client
        .put(route + '/' + post.id + '/vote')
        .auth(reader.token, { type: 'bearer' })
        .send({ value });
    expect((await vote(1).expect(200)).body.score).toBe(1);
    expect((await vote(1).expect(200)).body.score).toBe(1);
    expect((await vote(-1).expect(200)).body.score).toBe(-1);
    expect((await vote(0).expect(200)).body.score).toBe(0);
    await client
      .post(route + '/' + post.id + '/report')
      .auth(reader.token, { type: 'bearer' })
      .send({ reason: '测试举报' })
      .expect(201);
    const reported = await client
      .get(route + '/review')
      .auth(moderator.token, { type: 'bearer' })
      .expect(200);
    expect(reported.body.posts[0]?.reports).toEqual(['测试举报']);
    await review(post.id, 'post', 'hide').expect(201);
    const search = (term: string) =>
      client.get(route).query({ q: term, community: 'campus' }).expect(200);
    expect((await search('周末')).body.items).toEqual([]);
    expect(
      (await client.get(route).query({ q: '预约', community: 'questions' }).expect(200)).body.items,
    ).toEqual([expect.objectContaining({ id: other.id })]);
    await client.get(route + '/' + post.id).expect(404);
    await vote(1).expect(404);
    expect(
      (await h.db.selectFrom('audit_events').selectAll().where('target_id', '=', post.id).execute())
        .length,
    ).toBe(1);
  } finally {
    await h.close();
  }
});
