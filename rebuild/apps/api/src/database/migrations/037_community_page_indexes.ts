import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types.js';
export async function up(db: Kysely<Database>) {
  // Generated columns also track legacy/admin writes, which still update JSON.
  const existing=await db.introspection.getTables();
  const columns=new Set(existing.find(table=>table.name==='demo_entities')?.columns.map(column=>column.name));
  if(!columns.has('page_board'))await sql`ALTER TABLE demo_entities
    ADD COLUMN page_board VARCHAR(80) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.community'))) VIRTUAL,
    ADD COLUMN page_parent VARCHAR(64) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.postId'))) VIRTUAL,
    ADD COLUMN page_created BIGINT GENERATED ALWAYS AS (COALESCE(JSON_EXTRACT(data, '$.createdAt'), 0)) VIRTUAL,
    ADD COLUMN page_pinned INT GENERATED ALWAYS AS (IF(JSON_EXTRACT(data, '$.pinned') = true, 1, 0)) VIRTUAL,
    ADD COLUMN page_score DOUBLE GENERATED ALWAYS AS (COALESCE(JSON_EXTRACT(data, '$.feedScore'), JSON_EXTRACT(data, '$.createdAt') / 1800000, 0)) VIRTUAL,
    ADD COLUMN page_activity BIGINT GENERATED ALWAYS AS (COALESCE(JSON_EXTRACT(data, '$.activityAt'), JSON_EXTRACT(data, '$.createdAt'), 0)) VIRTUAL`.execute(db);
  const indexes=await sql<{Key_name:string}>`SHOW INDEX FROM demo_entities`.execute(db);
  if(!columns.has('page_reply_score'))await sql`ALTER TABLE demo_entities ADD COLUMN page_reply_score DOUBLE GENERATED ALWAYS AS (COALESCE(JSON_EXTRACT(data,'$.replyScore'),JSON_EXTRACT(data,'$.createdAt') / 100000000000000,0)) VIRTUAL`.execute(db);
  for (const [name, columns] of [
    ['community_feed_latest', ['kind','page_pinned','page_created','id']],
    ['community_feed_hot', ['kind','page_pinned','page_score','id']],
    ['community_feed_activity', ['kind','page_pinned','page_activity','id']],
    ['community_board_latest', ['kind','page_board','page_pinned','page_created','id']],
    ['community_board_hot', ['kind','page_board','page_pinned','page_score','id']],
    ['community_board_activity', ['kind','page_board','page_pinned','page_activity','id']],
    ['community_reply_page', ['kind','page_parent','page_created','id']],
    ['community_reply_hot', ['kind','page_parent','page_reply_score','id']],
  ] as const) if(!indexes.rows.some(index=>index.Key_name===name))await db.schema.createIndex(name).on('demo_entities').columns([...columns]).execute();
  await db.schema.createTable('community_post_bookmarks').ifNotExists()
    .addColumn('user_id','varchar(64)', c => c.notNull())
    .addColumn('post_id','varchar(64)', c => c.notNull())
    .addPrimaryKeyConstraint('community_bookmark_pk',['user_id','post_id']).execute();
  const bookmarkIndexes=await sql<{Key_name:string}>`SHOW INDEX FROM community_post_bookmarks`.execute(db);
  if(!bookmarkIndexes.rows.some(index=>index.Key_name==='community_bookmark_post'))await db.schema.createIndex('community_bookmark_post').on('community_post_bookmarks').column('post_id').execute();
  let after = '';
  for (;;) {
    const rows = await db.selectFrom('demo_user_states').select(['user_id','data']).where('user_id','>',after).orderBy('user_id').limit(100).execute();
    if (!rows.length) break;
    for (const row of rows) {
      const marks = [...new Set<string>(JSON.parse(row.data).bookmarks || [])];
      if (marks.length) await db.insertInto('community_post_bookmarks').values(marks.map(post_id => ({user_id:row.user_id,post_id}))).onDuplicateKeyUpdate({user_id:row.user_id}).execute();
    }
    after = rows.at(-1)!.user_id;
  }
  // Backfill in bounded batches. Each update checks its source JSON so a live
  // legacy write cannot be overwritten while this additive migration runs.
  let postAfter='';
  let replyAfter='';
  for(;;){
    const replies=await db.selectFrom('demo_entities').select(['id','data']).where('kind','=','reply').where('id','>',replyAfter).orderBy('id').limit(100).execute();
    if(!replies.length)break;
    const votes=await db.selectFrom('demo_entities').select(['id',sql<number>`JSON_LENGTH(data)`.as('n')]).where('id','in',replies.map(reply=>'replyVote:'+reply.id.slice(6))).execute();
    for(const reply of replies){
      const value=JSON.parse(reply.data),replyScore=Number(votes.find(vote=>vote.id==='replyVote:'+reply.id.slice(6))?.n||0)+value.createdAt/100000000000000;
      await db.updateTable('demo_entities').set({data:JSON.stringify({...value,replyScore})}).where('id','=',reply.id).where('data','=',reply.data).execute();
    }
    replyAfter=replies.at(-1)!.id;
  }
  for(;;){
    const posts=await db.selectFrom('demo_entities').select(['id','data']).where('kind','=','post').where('id','>',postAfter).orderBy('id').limit(100).execute();
    if(!posts.length)break;
    const ids=posts.map(post=>post.id.slice(5));
    const [replies,votes]=await Promise.all([
      db.selectFrom('demo_entities').select('page_parent').select(eb=>[eb.fn.count<number>('id').as('n'),eb.fn.max('page_created').as('activity')]).where('kind','=','reply').where('page_parent','in',ids).groupBy('page_parent').execute(),
      db.selectFrom('demo_entities').select(['id',sql<number>`JSON_LENGTH(data)`.as('n')]).where('id','in',ids.map(id=>'vote:'+id)).execute(),
    ]);
    for(const post of posts){
      const value=JSON.parse(post.data),repliesForPost=replies.find(reply=>reply.page_parent===value.id);
      const data=JSON.stringify({...value,replyCount:Number(repliesForPost?.n||0),activityAt:Math.max(value.createdAt,Number(repliesForPost?.activity||0)),feedScore:Number(votes.find(vote=>vote.id==='vote:'+value.id)?.n||0)+value.createdAt/1800000});
      await db.updateTable('demo_entities').set({data}).where('id','=',post.id).where('data','=',post.data).execute();
    }
    postAfter=posts.at(-1)!.id;
  }
}
