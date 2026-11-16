import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../database/database.types.js';
import { DemoBoard, DemoId, type DemoPost, type DemoReply, type DemoState } from './demo.schema.js';
import { legacyBoardCommunities } from '../../../../../packages/contracts/src/boards.js';
import { listBoards } from '../communities/board-directory.js';
export const PageQuery = z.object({sort:z.enum(['hot','latest','activity','following','recommended']).default('hot'),board:DemoBoard.optional(),tag:z.string().max(40).optional(),cursor:z.string().max(1500).optional(),focus:DemoId.optional(),thread:DemoId.optional(),notices:z.literal('1').optional()});
type Query = z.infer<typeof PageQuery>;
type Cursor = {key:string;pinned:number;rank:number;id:string};
function decode(value:string|undefined,key:string):Cursor|null {
  if (!value) return null;
  try { const c=JSON.parse(Buffer.from(value,'base64url').toString());
    if(c.key!==key||!Number.isFinite(c.rank)||![0,1].includes(c.pinned)||typeof c.id!=='string'||c.id.length>150)throw new Error();
    return c;
  } catch {throw new BadRequestException('INVALID_CURSOR');}
}
const encode=(c:Cursor)=>Buffer.from(JSON.stringify(c)).toString('base64url');
export class CommunityPages {
  constructor(private readonly db:Kysely<Database>){}
  async state(userId:string|null){
    const row=userId?await this.db.selectFrom('demo_user_states').select('data').where('user_id','=',userId).executeTakeFirst():null;
    const own:DemoState=row?JSON.parse(row.data):{};
    own.followedBoards??=Object.keys(legacyBoardCommunities);
    own.bookmarks??=[];
    return own;
  }
  async read(userId:string|null,query:Query,postId?:string){
    if(postId&&!DemoId.safeParse(postId).success)throw new BadRequestException('INVALID_INPUT');
    const own=await this.state(userId);
    const key=JSON.stringify([postId||'feed',query.sort,query.board||'',query.tag||'',userId,query.thread||'']);
    const after=decode(query.cursor,key);
    let posts:DemoPost[],replies:(DemoReply&{postId:string})[]=[],next:string|null=null;
    if(postId){
      const row=await this.db.selectFrom('demo_entities as e').select('e.data').where('e.id','=','post:'+postId).where('e.kind','=','post')
        .where('e.id','not in',this.db.selectFrom('admin_visibility').select('target').where('hidden','=',1)).executeTakeFirst();
      if(!row)throw new NotFoundException('POST_NOT_FOUND');
      posts=[JSON.parse(row.data)];
      const rank=query.sort==='latest'?'page_created':'page_reply_score';
      let read=this.db.selectFrom('demo_entities').select(['id','data',sql<number>`${sql.ref(rank)}`.as('rank')]).where('kind','=','reply').where('page_parent','=',postId);
      if(after)read=read.where(eb=>eb.or([eb(sql.ref(rank),'<',after.rank),eb.and([eb(sql.ref(rank),'=',after.rank),eb('id','<',after.id)])]));
      const rows=await read.orderBy(sql.ref(rank),'desc').orderBy('id','desc').limit(51).execute(),page=rows.slice(0,50);
      replies=page.map(r=>JSON.parse(r.data));
      if(rows.length>50){const last=page.at(-1)!;next=encode({key,pinned:0,rank:Number(last.rank),id:last.id});}
      // Deep reply links and accepted answers remain reachable outside page one.
      // Fetch at most the target plus its ancestor chain, never all other replies.
      const targets=[query.focus,query.thread,!after?posts[0]?.best:undefined,...replies.map(reply=>reply.parentId)].filter((id):id is string=>Boolean(id));
      const loaded=new Set(replies.map(r=>r.id));
      let frontier=[...new Set(targets)].filter(id=>!loaded.has(id));
      for(let depth=0;frontier.length&&depth<25;depth++){
        const rows=await this.db.selectFrom('demo_entities').select('data').where('id','in',frontier.slice(0,52).map(id=>'reply:'+postId+':'+id)).where('kind','=','reply').execute();
        const parents:string[]=[];
        for(const row of rows){
          const reply=JSON.parse(row.data) as DemoReply&{postId:string};
          if(!loaded.has(reply.id)){replies.push(reply);loaded.add(reply.id);}
          if(reply.parentId&&!loaded.has(reply.parentId))parents.push(reply.parentId);
        }
        frontier=[...new Set(parents)];
      }
    }else{
      const rank=query.sort==='hot'?'page_score':['activity','following'].includes(query.sort)?'page_activity':'page_created';
      let read=this.db.selectFrom('demo_entities as e')
        .select([sql<string>`CAST(JSON_SET(JSON_REMOVE(e.data,'$.html','$.updates'),'$.body',LEFT(JSON_UNQUOTE(JSON_EXTRACT(e.data,'$.body')),240)) AS CHAR)`.as('data'),'e.id','e.page_pinned',sql<number>`${sql.ref('e.'+rank)}`.as('rank')])
        .where('e.kind','=','post').where('e.id','not in',this.db.selectFrom('admin_visibility').select('target').where('hidden','=',1));
      if(query.board)read=read.where('e.page_board','=',query.board);
      if(query.tag)read=read.where(sql<boolean>`JSON_CONTAINS(JSON_EXTRACT(e.data,'$.tags'),${JSON.stringify(query.tag)})`);
      if(query.sort==='following')read=read.where(eb=>eb.or([
        own.followedBoards?.length?eb('e.page_board','in',own.followedBoards):sql<boolean>`false`,
        own.follows?.length?eb('e.id','in',own.follows.map(id=>'post:'+id)):sql<boolean>`false`,
        ...(own.tagFollows||[]).map(tag=>sql<boolean>`JSON_CONTAINS(JSON_EXTRACT(e.data,'$.tags'),${JSON.stringify(tag)})`),
      ]));
      if(after)read=read.where(eb=>eb.or([
        eb('e.page_pinned','<',after.pinned),
        eb.and([eb('e.page_pinned','=',after.pinned),eb(sql.ref('e.'+rank),'<',after.rank)]),
        eb.and([eb('e.page_pinned','=',after.pinned),eb(sql.ref('e.'+rank),'=',after.rank),eb('e.id','<',after.id)]),
      ]));
      const rows=await read.orderBy('e.page_pinned','desc').orderBy(sql.ref('e.'+rank),'desc').orderBy('e.id','desc').limit(21).execute(),page=rows.slice(0,20);
      posts=page.map(row=>({...JSON.parse(row.data),summary:true}));
      if(rows.length>20){const last=page.at(-1)!;next=encode({key,pinned:last.page_pinned,rank:Number(last.rank),id:last.id});}
      if(query.focus&&!posts.some(post=>post.id===query.focus)){
        const row=await this.db.selectFrom('demo_entities as e').select(sql<string>`CAST(JSON_SET(JSON_REMOVE(e.data,'$.html','$.updates'),'$.body',LEFT(JSON_UNQUOTE(JSON_EXTRACT(e.data,'$.body')),240)) AS CHAR)`.as('data')).where('e.kind','=','post').where('e.id','=','post:'+query.focus).where('e.id','not in',this.db.selectFrom('admin_visibility').select('target').where('hidden','=',1)).executeTakeFirst();
        if(row)posts.push({...JSON.parse(row.data),summary:true});
      }
    }
    const postIds=posts.map(p=>p.id),voteIds=[...postIds.map(id=>'vote:'+id),...replies.map(r=>'replyVote:'+r.postId+':'+r.id)];
    const authorIds=[...new Set([...posts.map(p=>p.authorId),...replies.map(r=>r.authorId),...(userId?[userId]:[])])];
    const hiddenIds=[...new Set([...replies.flatMap(r=>['reply:'+r.postId+':'+r.id,...(r.replyTo?['reply:'+r.postId+':'+r.replyTo]:[])]),...posts.filter(p=>p.best).map(p=>'reply:'+p.id+':'+p.best)])];
    const [votes,users,hidden,stars,boards,version,reviews,management,wikiRows,replyNotices,tagNotices]=await Promise.all([
      voteIds.length?this.db.selectFrom('demo_entities').select(['id',sql<number>`JSON_LENGTH(data)`.as('count'),sql<number>`JSON_CONTAINS(data,${JSON.stringify(userId||'')})`.as('active')]).where('id','in',voteIds).execute():[],
      authorIds.length?this.db.selectFrom('users').select(['id','nickname','deleted_at']).where('id','in',authorIds).execute():[],
      hiddenIds.length?this.db.selectFrom('admin_visibility').select('target').where('hidden','=',1).where('target','in',hiddenIds).execute():[],
      postIds.length?this.db.selectFrom('community_post_bookmarks').select('post_id').select(eb=>eb.fn.count<number>('user_id').as('count')).where('post_id','in',postIds).groupBy('post_id').execute():[],
      listBoards(this.db),this.db.selectFrom('demo_content').select('version').where('id','=','global').executeTakeFirst(),
      userId?this.db.selectFrom('post_reviews').select(['id','board','status','reason','created_at']).select(sql<string>`JSON_UNQUOTE(JSON_EXTRACT(data,'$.title'))`.as('title')).where('user_id','=',userId).orderBy('created_at','desc').limit(50).execute():[],
      userId?this.db.selectFrom('admin_notifications').selectAll().where('user_id','=',userId).orderBy('created_at','desc').limit(100).execute():[],
      this.db.selectFrom('demo_entities').select(sql<string>`CAST(JSON_REMOVE(data,'$.body','$.history','$.html') AS CHAR)`.as('data')).where('kind','=','wiki').where('id','not in',this.db.selectFrom('admin_visibility').select('target').where('hidden','=',1)).limit(3).execute(),
      userId&&query.notices?sql<{id:string;post_id:string;author:string;title:string;created:number}>`SELECT JSON_UNQUOTE(JSON_EXTRACT(r.data,'$.id')) AS id,r.page_parent AS post_id,COALESCE(u.nickname,JSON_UNQUOTE(JSON_EXTRACT(r.data,'$.author'))) AS author,JSON_UNQUOTE(JSON_EXTRACT(p.data,'$.title')) AS title,r.page_created AS created
        FROM demo_entities r INNER JOIN demo_entities p ON p.id=CONCAT('post:',r.page_parent)
        LEFT JOIN demo_entities target ON target.id=CONCAT('reply:',r.page_parent,':',JSON_UNQUOTE(JSON_EXTRACT(r.data,'$.replyTo')))
        LEFT JOIN users u ON u.id=JSON_UNQUOTE(JSON_EXTRACT(r.data,'$.authorId'))
        WHERE r.kind='reply' AND JSON_UNQUOTE(JSON_EXTRACT(r.data,'$.authorId'))<>${userId}
        AND ((${own.notifPrefs?.reply!==false} AND (JSON_UNQUOTE(JSON_EXTRACT(p.data,'$.authorId'))=${userId} OR JSON_UNQUOTE(JSON_EXTRACT(target.data,'$.authorId'))=${userId}))
          OR (${own.notifPrefs?.follow!==false} AND JSON_CONTAINS(${JSON.stringify(own.follows||[])},JSON_QUOTE(r.page_parent))))
        AND NOT EXISTS(SELECT 1 FROM admin_visibility v WHERE v.target IN (r.id,p.id) AND v.hidden=1)
        ORDER BY r.page_created DESC,r.id DESC LIMIT 100`.execute(this.db).then(result=>result.rows):[],
      userId&&query.notices&&own.notifPrefs?.follow!==false&&own.tagFollows?.length?this.db.selectFrom('demo_entities').select(['id','page_created',sql<string>`JSON_UNQUOTE(JSON_EXTRACT(data,'$.title'))`.as('title')]).where('kind','=','post').where(sql<string>`JSON_UNQUOTE(JSON_EXTRACT(data,'$.authorId'))`,'!=',userId).where(eb=>eb.or(own.tagFollows!.map(tag=>sql<boolean>`JSON_CONTAINS(JSON_EXTRACT(data,'$.tags'),${JSON.stringify(tag)})`))).where('id','not in',this.db.selectFrom('admin_visibility').select('target').where('hidden','=',1)).orderBy('page_created','desc').limit(100).execute():[],
    ]);
    const names=new Map(users.map(u=>[u.id,u.deleted_at?'已注销用户':u.nickname])),hiddenSet=new Set(hidden.map(r=>r.target)),voteMap=new Map(votes.map(v=>[v.id,v]));
    for(const p of posts){
      p.author=names.get(p.authorId)||p.author;
      p.likes=Number(voteMap.get('vote:'+p.id)?.count||0)-Number(Boolean(voteMap.get('vote:'+p.id)?.active));
      if(p.best&&hiddenSet.has('reply:'+p.id+':'+p.best)){delete p.best;delete p.wikiRef;}
    }
    const comments:Record<string,DemoReply[]>={};
    for(const r of replies){
      const {postId,...reply}=r;reply.author=names.get(reply.authorId)||reply.author;
      reply.likes=Number(voteMap.get('replyVote:'+postId+':'+r.id)?.count||0)-Number(Boolean(voteMap.get('replyVote:'+postId+':'+r.id)?.active));
      if(hiddenSet.has('reply:'+postId+':'+r.id)){reply.body='该回复已被管理员隐藏';delete reply.image;delete reply.replyBody;}
      if(r.replyTo&&hiddenSet.has('reply:'+postId+':'+r.replyTo))reply.replyBody='该回复已被管理员隐藏';
      (comments[postId]??=[]).push(reply);
    }
    return {partial:true,version:version?.version||0,boards,
      postReviews:reviews.map(review=>({id:review.id,board:review.board,title:review.title,status:review.status,reason:review.reason,createdAt:review.created_at.toISOString()})),
      content:{posts:posts.map(p=>({...p,stars:Math.max(0,Number(stars.find(s=>s.post_id===p.id)?.count||0)-Number(Boolean(own.bookmarks?.includes(p.id))))})),comments,wiki:wikiRows.map(row=>JSON.parse(row.data)),notifications:[
        ...management.map(notice=>({id:notice.id,text:notice.text,detail:notice.detail,href:notice.href,createdAt:notice.created_at.getTime()})),
        ...replyNotices.map(reply=>({id:'reply-'+reply.id,text:reply.author+' 回复了帖子',detail:reply.title,href:'#/posts/'+reply.post_id+'#cm-'+reply.id,createdAt:Number(reply.created)})),
        ...tagNotices.map(post=>({id:'post-'+post.id.slice(5),text:'关注的标签有新帖',detail:post.title,href:'#/posts/'+post.id.slice(5),createdAt:Number(post.page_created)})),
      ].sort((a,b)=>b.createdAt-a.createdAt).slice(0,100)},
      userState:{...own,likes:posts.filter(p=>voteMap.get('vote:'+p.id)?.active).map(p=>p.id),commentLikes:replies.filter(r=>voteMap.get('replyVote:'+r.postId+':'+r.id)?.active).map(r=>r.postId+':'+r.id),best:Object.fromEntries(posts.filter(p=>p.best).map(p=>[p.id,p.best!])),threads:[]},
      contacts:[],profiles:[],page:{key,kind:postId?'post':'feed',postId:postId||null,next,size:postId?50:20},
    };
  }
}
