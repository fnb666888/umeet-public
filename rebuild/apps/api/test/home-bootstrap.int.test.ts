import { expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp } from './support/test-app';

it('embeds only the anonymous first page and never private or hidden content', async () => {
  const h = await createTestApp();
  try {
    await h.db.insertInto('demo_entities').values(Array.from({ length: 23 }, (_, index) => ({
      id: 'post:bootstrap-' + index, kind: 'post', data: JSON.stringify({
        id: 'bootstrap-' + index, community: 'daily', title: 'Public title ' + index,
        body: 'Public body', author: 'Public author', authorId: 'public-author', likes: 0, createdAt: index,
      }),
    }))).execute();
    await h.db.insertInto('admin_visibility').values({ target: 'post:bootstrap-22', hidden: 1 }).execute();
    await h.db.insertInto('demo_entities').values([
      {id:'reply:bootstrap-21:hidden',kind:'reply',data:JSON.stringify({id:'hidden',postId:'bootstrap-21',authorId:'public-author',author:'Public author',body:'PRIVATE_HIDDEN_BODY',image:'PRIVATE_HIDDEN_IMAGE',createdAt:1})},
      {id:'reply:bootstrap-21:quote',kind:'reply',data:JSON.stringify({id:'quote',postId:'bootstrap-21',authorId:'public-author',author:'Public author',body:'Visible reply',replyTo:'hidden',replyBody:'PRIVATE_HIDDEN_BODY',createdAt:2})},
      {id:'reply:bootstrap-22:excluded',kind:'reply',data:JSON.stringify({id:'excluded',postId:'bootstrap-22',authorId:'public-author',author:'Public author',body:'EXCLUDED_POST_REPLY',createdAt:3})},
    ]).execute();
    await h.db.insertInto('admin_visibility').values({target:'reply:bootstrap-21:hidden',hidden:1}).execute();
    const { body } = await request(h.app.getHttpServer()).get('/api/v1/demo/bootstrap').expect(200);
    expect(body.bootstrap).toBe(true);
    expect(body.actor).toBeNull();
    expect(body.content.posts).toHaveLength(20);
    expect(body.content.posts.some((post: { id: string }) => post.id === 'bootstrap-22')).toBe(false);
    expect(body.content.notifications).toEqual([]);
    expect(body.contacts).toEqual([]);
    expect(body.profiles).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('PRIVATE_HIDDEN');
    expect(JSON.stringify(body)).not.toContain('EXCLUDED_POST_REPLY');
    expect(body.content.comments['bootstrap-21']).toHaveLength(2);
    expect(body.content.comments['bootstrap-21'][0].image).toBeUndefined();
    expect(body.content.comments['bootstrap-21'][1].replyBody).toBe('该回复已被管理员隐藏');
    expect(body.userState).toEqual({ likes: [], commentLikes: [], best: {}, threads: [] });
  } finally { await h.close(); }
});
