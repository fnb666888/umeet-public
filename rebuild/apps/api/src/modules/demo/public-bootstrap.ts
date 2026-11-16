import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type { DemoPost, DemoReply } from '../../../../../packages/contracts/src/community.js';
import { listBoards } from '../communities/board-directory.js';
/** Public first page: never enumerate account preferences, private state or messages. */
export async function publicBootstrap(db: Kysely<Database>) {
  const [rows, boards, version] = await Promise.all([
    db.selectFrom('demo_entities as entity').select(['entity.data'])
      .where('entity.kind', '=', 'post')
      .where('entity.id', 'not in', db.selectFrom('admin_visibility').select('target').where('hidden','=',1))
      .orderBy(sql<number>`JSON_EXTRACT(entity.data, '$.createdAt')`, 'desc').limit(20).execute(),
    listBoards(db), db.selectFrom('demo_content').select('version').where('id','=','global').executeTakeFirst(),
  ]);
  const posts = rows.map(row => JSON.parse(row.data) as DemoPost);
  const ids = posts.map(post => post.id);
  const replies = ids.length ? await db.selectFrom('demo_entities').select('data').where('kind','=','reply')
    .where(sql<string>`JSON_UNQUOTE(JSON_EXTRACT(data, '$.postId'))`, 'in', ids)
    .orderBy(sql<number>`JSON_EXTRACT(data, '$.createdAt')`).limit(200).execute() : [];
  const authorIds = [...new Set([...posts.map(p => p.authorId), ...replies.map(r => JSON.parse(r.data).authorId as string)])];
  const replyTargets = replies.map(row => {
    const reply = JSON.parse(row.data) as DemoReply & {postId:string};
    return ['reply:' + reply.postId + ':' + reply.id, ...(reply.replyTo ? ['reply:' + reply.postId + ':' + reply.replyTo] : [])];
  });
  const visibilityTargets = [...new Set([...replyTargets.flat(), ...posts.filter(p => p.best).map(p => 'reply:' + p.id + ':' + p.best)])];
  const [users, hidden] = await Promise.all([
    authorIds.length ? db.selectFrom('users').select(['id','nickname']).where('id','in',authorIds).execute() : [],
    visibilityTargets.length ? db.selectFrom('admin_visibility').select('target').where('hidden','=',1).where('target','in',visibilityTargets).execute() : [],
  ]);
  const names = new Map(users.map(user => [user.id,user.nickname])), hiddenReplies = new Set(hidden.map(row => row.target));
  const comments: Record<string, DemoReply[]> = {};
  for (const row of replies) {
    const {postId, ...reply} = JSON.parse(row.data) as DemoReply & {postId:string};
    reply.author = names.get(reply.authorId) ?? reply.author;
    if (hiddenReplies.has('reply:' + postId + ':' + reply.id)) { reply.body = '该回复已被管理员隐藏'; delete reply.image; delete reply.replyBody; }
    if (reply.replyTo && hiddenReplies.has('reply:' + postId + ':' + reply.replyTo)) reply.replyBody = '该回复已被管理员隐藏';
    (comments[postId] ??= []).push(reply);
  }
  for (const post of posts) {
    post.author = names.get(post.authorId) ?? post.author;
    if (post.best && hiddenReplies.has('reply:' + post.id + ':' + post.best)) { delete post.best; delete post.wikiRef; }
  }
  return {bootstrap:true, actor:null, version:version?.version ?? 0, boards,
    content:{posts, comments, wiki:[], notifications:[]},
    userState:{likes:[], commentLikes:[], best:Object.fromEntries(posts.filter(p => p.best).map(p => [p.id,p.best])), threads:[]}, contacts:[], profiles:[]};
}
