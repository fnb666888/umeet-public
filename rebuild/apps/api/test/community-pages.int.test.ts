import { expect, it } from 'vitest';
import {randomUUID} from 'node:crypto';
import {sql} from 'kysely';
import {writeFileSync} from 'node:fs';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service';

it('reads bounded pages with stable cursors, personal flags and hidden evidence redaction', async () => {
  const h = await createTestApp();
  try {
    const auth = await new PasswordAuthService(h.db).register({username: 'paged_member', password: 'Paged reads password 91!'}, 'pages');
    const id = auth.actor.userId;
    await h.db.insertInto('demo_entities').values(Array.from({length: 105}, (_, i) => ({id:'post:p'+i, kind:'post', data:JSON.stringify({id:'p'+i,community:i % 2 ? 'daily' : 'questions',title:'Post '+i,body:'x'.repeat(2000),html:'PRIVATE_FULL_HTML',author:'Author',authorId:id,likes:0,createdAt:1000+i})}))).execute();
    await h.db.insertInto('demo_user_states').values({user_id:id,data:JSON.stringify({bookmarks:['p103'],follows:['p103'],privacyPrefs:{marksPublic:false}}),updated_at:new Date()}).execute();
    await h.db.insertInto('demo_entities').values({id:'vote:p103',kind:'vote',data:JSON.stringify([id])}).execute();
    await h.db.insertInto('admin_visibility').values({target:'post:p104',hidden:1}).execute();
    const client = request(h.app.getHttpServer());
    const get = (path:string) => client.get('/api/v1/demo/pages/'+path).set('Authorization','Bearer '+auth.token);
    const first = (await get('feed?sort=latest').expect(200)).body;
    expect(first.content.posts).toHaveLength(20);
    expect(first.content.posts[0].id).toBe('p103');
    expect(first.content.posts[0].html).toBeUndefined();
    expect(first.content.posts[0].body.length).toBeLessThanOrEqual(240);
    expect(first.content.comments).toEqual({});
    expect(first.profiles).toEqual([]); expect(first.contacts).toEqual([]);
    expect(first.userState.likes).toEqual(['p103']);
    expect(first.userState.bookmarks).toEqual(['p103']);
    const second = (await get('feed?sort=latest&cursor='+encodeURIComponent(first.page.next)).expect(200)).body;
    expect(second.content.posts).toHaveLength(20);
    expect(second.content.posts.some((p:{id:string}) => first.content.posts.some((a:{id:string}) => a.id===p.id))).toBe(false);
    await get('feed?sort=hot&cursor='+encodeURIComponent(first.page.next)).expect(400);
    const board = (await get('feed?sort=latest&board=daily').expect(200)).body;
    expect(board.content.posts.every((p:{community:string}) => p.community==='daily')).toBe(true);
    await get('posts/p104').expect(404);
    await h.db.insertInto('demo_entities').values(Array.from({length:75},(_,i)=>({id:'reply:p103:r'+i,kind:'reply',data:JSON.stringify({id:'r'+i,postId:'p103',author:'Author',authorId:id,body:'Reply '+i,createdAt:2000+i,likes:0,...(i===1?{replyTo:'r0',replyBody:'HIDDEN_SECRET'}:{})})}))).execute();
    await h.db.updateTable('demo_entities').set({data:JSON.stringify({id:'r0',postId:'p103',author:'Author',authorId:id,body:'HIDDEN_SECRET',image:'HIDDEN_SECRET_IMAGE',createdAt:2000,likes:0})}).where('id','=','reply:p103:r0').execute();
    await h.db.insertInto('admin_visibility').values({target:'reply:p103:r0',hidden:1}).execute();
    const detail = (await get('posts/p103').expect(200)).body;
    expect(detail.content.posts[0].body).toHaveLength(2000);
    expect(detail.content.comments.p103).toHaveLength(50);
    expect(JSON.stringify(detail)).not.toContain('HIDDEN_SECRET');
    expect(detail.page.next).toBeTruthy();
    const rest = (await get('posts/p103?cursor='+encodeURIComponent(detail.page.next)).expect(200)).body;
    expect(rest.content.comments.p103).toHaveLength(25);
    expect(rest.page.next).toBeNull();
    const focused=(await get('posts/p103?focus=r0').expect(200)).body;
    expect(focused.content.comments.p103.some((reply:{id:string})=>reply.id==='r0')).toBe(true);
    expect(JSON.stringify(focused)).not.toContain('HIDDEN_SECRET');
    await client.post('/api/v1/demo/operations?projection=page').set('Authorization','Bearer '+auth.token)
      .send({id:randomUUID(),operations:[{type:'state.save',state:{bookmarks:['p103','p102']}}]}).expect(201,{ok:true});
    expect(await h.db.selectFrom('community_post_bookmarks').select('post_id').where('user_id','=',id).execute()).toHaveLength(2);
    await client.post('/api/v1/demo/operations?projection=page').set('Authorization','Bearer '+auth.token)
      .send({id:randomUUID(),operations:[{type:'reply.vote',postId:'p103',replyId:'r2',value:true}]}).expect(201);
    const hottest=(await get('posts/p103').expect(200)).body;
    expect(hottest.content.comments.p103[0].id).toBe('r2');
    const latest=(await get('posts/p103?sort=latest').expect(200)).body;
    expect(latest.content.comments.p103[0].id).toBe('r74');
    const anonymous = (await client.get('/api/v1/demo/pages/feed?sort=latest').expect(200)).body;
    expect(anonymous.actor).toBeNull(); expect(anonymous.userState.bookmarks).toEqual([]);
    await h.db.insertInto('moderation_penalties').values({id:'paged-block',user_id:id,board:null,capability:'suspension',reason:'test',until_at:null,revoked_at:null,created_at:new Date()}).execute();
    const blocked = (await get('feed').expect(200)).body;
    expect(blocked.suspended).toBe(true); expect(blocked.content.posts).toEqual([]);
  } finally { await h.close(); }
});

it('keeps response size bounded at ten thousand posts and uses ordered feed indexes',async()=>{
  const h=await createTestApp();
  try{
    const client=request(h.app.getHttpServer()),samples=[];
    for(let batch=0;batch<100;batch++){
      await h.db.insertInto('demo_entities').values(Array.from({length:100},(_,index)=>{
        const i=batch*100+index,id='growth'+String(i).padStart(5,'0');
        return {id:'post:'+id,kind:'post',data:JSON.stringify({id,community:'daily',title:'Growth '+id,body:'x'.repeat(4000),author:'Growth',authorId:'growth-user',createdAt:100000+i,likes:0})};
      })).execute();
      if(batch===0||batch===99){
        const start=performance.now(),response=await client.get('/api/v1/demo/pages/feed?sort=latest').expect(200);
        expect(response.body.content.posts).toHaveLength(20);
        samples.push({posts:(batch+1)*100,bytes:Buffer.byteLength(response.text),ms:Math.round(performance.now()-start)});
      }
    }
    expect(samples[1]!.bytes).toBeLessThan(samples[0]!.bytes*1.1);
    const plan=await sql<{key:string;Extra:string}>`EXPLAIN SELECT id FROM demo_entities WHERE kind='post' ORDER BY page_pinned DESC,page_created DESC,id DESC LIMIT 21`.execute(h.db);
    expect(plan.rows[0]!.key).toBe('community_feed_latest');
    expect(plan.rows[0]!.Extra).not.toContain('filesort');
    console.log('COMMUNITY_GROWTH_EVIDENCE',JSON.stringify({samples,index:plan.rows[0]!.key}));
    writeFileSync('.runtime/community-growth.json',JSON.stringify({samples,index:plan.rows[0]!.key},null,2));
  }finally{await h.close();}
});
