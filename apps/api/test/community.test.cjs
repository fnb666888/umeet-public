const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const os=require('node:os');
const mysql=process.env.DATABASE_PROVIDER==='mysql';
if(mysql){const u=new URL(process.env.UMEET_TEST_DATABASE_URL||'');if(u.hostname!=='127.0.0.1'||!/^\/umeet_tests_[a-z0-9_]+$/.test(u.pathname))throw new Error('MySQL 测试只能使用本机独立测试数据库');}
process.env.NODE_ENV='test';process.env.DEMO_MODE='true';process.env.LOCAL_DATABASE=mysql?'false':'true';process.env.DISABLE_BACKGROUND_TASKS='true';
process.env.DATABASE_PROVIDER=mysql?'mysql':'postgresql';
process.env.DATABASE_URL=mysql?process.env.UMEET_TEST_DATABASE_URL:'postgresql://umeet_test:umeet_test_only@127.0.0.1:55433/umeet_tests';
const jsonPath=(key)=>mysql?'$.'+key:[key];
process.env.LOCAL_DB_DIR=path.join(os.tmpdir(),'umeet-api-tests');
process.env.JWT_SECRET='test-only-'+randomUUID()+randomUUID();process.env.ADMIN_PASSWORD='test-only-admin';
// 测试不连接个人环境中的外部服务。
for(const key of ['REDIS_URL','WECHAT_APP_ID','WECHAT_APP_SECRET','WECHAT_SUBSCRIBE_TEMPLATE','WECHAT_SUBSCRIBE_FIELD_MAP','SMTP_HOST'])process.env[key]='';
process.env.STORAGE_PROVIDER='local';
require('reflect-metadata');
const {NestFactory}=require('@nestjs/core');const {ValidationPipe}=require('@nestjs/common');
const {AppModule}=require('../dist/app.module');const {Database}=require('../dist/core/database');const {Tasks}=require('../dist/notifications/tasks.module');const {ErrorFilter}=require('../dist/core/filter');
let app,base,db,tasks,student,peer,other,admin,unverified;
async function request(url,token,method='GET',body,extra={}){
 const response=await fetch(base+url,{method,headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...extra},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 const data=await response.json().catch(()=>null);return {status:response.status,data};
}
const payload=(extra={})=>({schoolId:'demo-school',campusId:'main',category:'GENERAL',title:'集成测试分享',content:'这是用于验证社区流程的测试内容。',...extra});
async function create(extra={},who=student,key=randomUUID()){const r=await request('/posts',who,'POST',payload(extra),{'Idempotency-Key':key});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
async function approve(id,version=1){const r=await request(`/admin/posts/${id}/review`,admin,'POST',{decision:'APPROVE',reason:'人工核验通过',version});assert.equal(r.status,201,JSON.stringify(r.data));}
before(async()=>{
 app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.useGlobalFilters(new ErrorFilter());await app.listen(0,'127.0.0.1');base=await app.getUrl()+'/api/v1';db=app.get(Database);tasks=app.get(Tasks);
 // 只清空独立测试数据库中的测试数据，保留迁移表。
 await db.$transaction(['subscriptionDelivery','notification','report','reaction','comment','media','verification','post','feedback','consent','audit','outbox','block'].map(model=>db[model].deleteMany()));
 await db.user.updateMany({data:{banned:false,deletedAt:null}});
 await db.membership.deleteMany({where:{userId:'demo-unverified'}});
 for(const role of ['student','peer','other','admin','unverified']){const r=await request('/auth/demo',null,'POST',{role});assert.equal(r.status,201);if(role==='student')student=r.data.token;if(role==='peer')peer=r.data.token;if(role==='other')other=r.data.token;if(role==='admin')admin=r.data.token;if(role==='unverified')unverified=r.data.token;}
}, {timeout:120000});
after(async()=>{await app?.close();});

test('微信登录区分连接失败、配置异常、过期凭证，并保存真实身份',async()=>{
 const originalFetch=global.fetch,oldId=process.env.WECHAT_APP_ID,oldSecret=process.env.WECHAT_APP_SECRET;
 process.env.WECHAT_APP_ID='test-only-appid';process.env.WECHAT_APP_SECRET='test-only-secret';
 let mode='transport';const openid='wechat-test-'+randomUUID();
 global.fetch=async(input,options)=>{
  const address=String(input);
  if(!address.startsWith('https://api.weixin.qq.com/sns/jscode2session'))return originalFetch(input,options);
  if(mode==='transport')throw new TypeError('fetch failed',{cause:{code:'SELF_SIGNED_CERT_IN_CHAIN'}});
  const body=mode==='config'?{errcode:40125}:mode==='invalid'?{errcode:40029}:{openid,session_key:'must-not-return-to-client'};
  return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  let r=await request('/auth/wechat',null,'POST',{code:'test-only-code'});
  assert.equal(r.status,503);assert.match(r.data.message,/连接失败/);
  assert.ok(!JSON.stringify(r.data).includes('SELF_SIGNED_CERT'));
  mode='config';r=await request('/auth/wechat',null,'POST',{code:'test-only-code'});assert.equal(r.status,503);
  mode='invalid';r=await request('/auth/wechat',null,'POST',{code:'test-only-code'});assert.equal(r.status,401);
  mode='success';r=await request('/auth/wechat',null,'POST',{code:'test-only-code'});assert.equal(r.status,201);
  assert.equal(typeof r.data.token,'string');assert.equal(r.data.session_key,undefined);
  assert.equal((await request('/me',r.data.token)).data.openid,undefined);
  assert.ok(await db.user.findUnique({where:{openid}}));
 }finally{global.fetch=originalFetch;process.env.WECHAT_APP_ID=oldId;process.env.WECHAT_APP_SECRET=oldSecret;}
});

test('长中文与表情正文、学校邮箱 JSON 和不区分大小写搜索可正常保存查询',async()=>{
 const content='校园生活🌱'.repeat(350),p=await create({title:'MySQLCaseSearch'+randomUUID(),content});
 assert.equal((await db.post.findUniqueOrThrow({where:{id:p.id}})).content,content);
 assert.deepEqual((await db.school.findUniqueOrThrow({where:{id:'demo-school'}})).emailDomains,['example.edu.cn']);
 await approve(p.id);
 const found=await request('/posts?schoolId=demo-school&q=mysqlcasesearch',peer);
 assert.ok(found.data.items.some(row=>row.id===p.id));
});
test('身份和幂等键区分大小写，参数化行锁不接受注入',async()=>{
 const id=randomUUID();
 const a=await db.user.create({data:{id:'case-'+id,nickname:'测试',openid:'OpenId-'+id}});
 const b=await db.user.create({data:{id:'Case-'+id,nickname:'测试',openid:'openid-'+id}});
 assert.notEqual(a.id,b.id);
 const key='Key-'+randomUUID(),p=await create({},student,key),q=await create({},student,key.toLowerCase());
 assert.notEqual(p.id,q.id);
 const {sql}=require('../dist/core/database-dialect');
 const rows=await db.$queryRaw(sql`SELECT id FROM "Post" WHERE id=${"' OR 1=1 --"} FOR UPDATE`);
 assert.equal(rows.length,0);
});
test('并行后台进程只领取一次同一个通知事件',async()=>{
 const e=await db.outbox.create({data:{kind:'NOTIFY',payload:{userId:'demo-peer',title:'并行领取测试',body:'测试内容'}}});
 await Promise.all([tasks.process(e.id),tasks.process(e.id),tasks.process(e.id)]);
 assert.equal(await db.notification.count({where:{eventId:e.id}}),1);
 assert.equal((await db.outbox.findUniqueOrThrow({where:{id:e.id}})).status,'DONE');
});
test('数据库任务模式在生产 worker 中无需 Redis 也能处理持久事件',async()=>{
 const e=await db.outbox.create({data:{kind:'NOTIFY',payload:{userId:'demo-peer',title:'生产任务测试',body:'持久任务内容'}}});
 const prior={NODE_ENV:process.env.NODE_ENV,TASK_TRANSPORT:process.env.TASK_TRANSPORT};
 const original=tasks.process;tasks.process=async id=>{if(id===e.id)return original.call(tasks,id);};
 try{
  process.env.NODE_ENV='production';process.env.TASK_TRANSPORT='database';
  await tasks.tick();
  assert.equal((await db.outbox.findUniqueOrThrow({where:{id:e.id}})).status,'DONE');
  assert.equal(await db.notification.count({where:{eventId:e.id}}),1);
 }finally{tasks.process=original;for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('未登录、未认证、跨校和伪造身份不能发帖',async()=>{
 assert.equal((await request('/posts',null,'POST',payload(),{'Idempotency-Key':randomUUID()})).status,401);
 assert.equal((await request('/posts',unverified,'POST',payload(),{'Idempotency-Key':randomUUID()})).status,403);
 assert.equal((await request('/posts',other,'POST',payload(),{'Idempotency-Key':randomUUID()})).status,403);
 assert.equal((await request('/posts',student,'POST',payload({authorId:'demo-peer'}),{'Idempotency-Key':randomUUID()})).status,400);
 assert.equal((await request('/posts',student,'POST',payload({campusId:'other-campus'}),{'Idempotency-Key':randomUUID()})).status,400);
});
test('发帖去重并在审核通过前不可公开',async()=>{
 const key=randomUUID(),p=await create({},student,key);assert.equal(p.status,'PENDING');
 assert.equal((await request(`/posts/${p.id}`,peer)).status,404);
 assert.equal((await request('/posts',student,'POST',payload(),{'Idempotency-Key':key})).data.id,p.id);
 assert.equal((await request('/posts',student,'POST',payload({title:'不同内容'}),{'Idempotency-Key':key})).status,409);
 assert.equal((await request(`/admin/posts/${p.id}/review`,student,'POST',{decision:'APPROVE',reason:'绕过审核',version:1})).status,403);
 await approve(p.id);assert.equal((await request(`/posts/${p.id}`,peer)).data.full,true);
 assert.equal((await request(`/posts/${p.id}`,null)).data.full,false);
 assert.equal((await request(`/posts/${p.id}`,peer,'DELETE')).status,403);
});
test('匿名帖子、评论和通知不泄漏真实作者及联系方式',async()=>{
 const p=await create({category:'TREEHOLE'});await approve(p.id);
 assert.equal((await request(`/posts/${p.id}`,null)).status,403);
 const publicPost=(await request(`/posts/${p.id}`,peer)).data;
 assert.match(publicPost.authorName,/同学 /);
 assert.equal(publicPost.authorId,undefined);assert.equal(publicPost.openid,undefined);assert.equal(publicPost.contact,undefined);
 assert.equal((await request(`/posts/${p.id}/contact`,peer)).status,403);
 const c=await request(`/posts/${p.id}/comments`,peer,'POST',{content:'一起慢慢向前走。'});assert.equal(c.status,201);
 assert.equal((await request(`/posts/${p.id}/comments`,student)).data.length,0);
 const reviewed=await request(`/admin/comments/${c.data.id}/review`,admin,'POST',{decision:'APPROVE',reason:'评论审核通过'});assert.equal(reviewed.status,201);
 const comments=(await request(`/posts/${p.id}/comments`,student)).data;
 assert.match(comments[0].authorName,/同学 /);assert.equal(comments[0].authorId,undefined);
 const events=await db.outbox.findMany({where:{kind:'NOTIFY'}});for(const e of events)await tasks.process(e.id);
 const messages=(await request('/notifications',student)).data;const reply=messages.find(n=>n.postId===p.id&&n.title==='收到一条新回复');
 assert.ok(reply);assert.ok(!reply.body.includes('周同学'));assert.ok(!reply.body.includes('demo-peer'));
});
test('联系方式受同校权限控制，重复点赞不重复计数',async()=>{
 const p=await create({category:'MARKET',priceFen:3500,contact:'测试联系账号'});await approve(p.id);
 assert.equal((await request(`/posts/${p.id}/contact`,other)).status,403);
 assert.equal((await request(`/posts/${p.id}/contact`,peer)).data.contact,'测试联系账号');
 for(let i=0;i<3;i++)assert.equal((await request(`/posts/${p.id}/reactions`,peer,'POST',{type:'LIKE',active:true})).status,201);
 assert.equal((await request(`/posts/${p.id}`,peer)).data.likeCount,1);
 assert.equal((await request(`/posts/${p.id}/state`,peer,'PUT',{state:'SOLD'})).status,403);
 assert.equal((await request(`/posts/${p.id}/state`,student,'PUT',{state:'FOUND'})).status,400);
 assert.equal((await request(`/posts/${p.id}/state`,student,'PUT',{state:'SOLD'})).status,200);
});
test('旧版本审核及已删除内容的延迟任务不能恢复帖子',async()=>{
 const p=await create();
 assert.equal((await request(`/posts/${p.id}`,student,'PUT',payload({title:'修改后的测试分享'}))).status,200);
 assert.equal((await request(`/admin/posts/${p.id}/review`,admin,'POST',{decision:'APPROVE',reason:'旧审核结果',version:1})).status,409);
 assert.equal((await request(`/posts/${p.id}`,student,'DELETE')).status,200);
 const events=await db.outbox.findMany({where:{kind:'MODERATE_POST',payload:{path:jsonPath('id'),equals:p.id}}});for(const e of events)await tasks.process(e.id);
 assert.equal((await db.post.findUnique({where:{id:p.id}})).status,'DELETED');
 assert.equal((await request(`/admin/posts/${p.id}/review`,admin,'POST',{decision:'APPROVE',reason:'恢复已删内容',version:3})).status,409);
});
test('通知事件重放只产生一条记录',async()=>{
 const event=await db.outbox.create({data:{kind:'NOTIFY',payload:{userId:'demo-student',title:'可靠消息测试',body:'测试正文'}}});
 await tasks.process(event.id);await db.outbox.update({where:{id:event.id},data:{status:'PENDING'}});await tasks.process(event.id);
 assert.equal(await db.notification.count({where:{eventId:event.id}}),1);
});
test('举报隐藏后退出搜索，屏蔽作者后退出信息流',async()=>{
 const p=await create({title:'唯一举报测试'+randomUUID()});await approve(p.id);
 const r=await request(`/posts/${p.id}/reports`,peer,'POST',{reason:'测试举报说明'});assert.equal(r.status,201);
 assert.equal((await request(`/admin/reports/${r.data.id}/resolve`,admin,'POST',{decision:'HIDE',reason:'已核实并隐藏测试内容'})).status,201);
 assert.equal((await request(`/posts/${p.id}`,peer)).status,404);
 const q=await request('/posts?schoolId=demo-school&q='+encodeURIComponent(p.id),peer);assert.equal(q.data.items.length,0);
 const p2=await create({},peer);await approve(p2.id);
 assert.equal((await request(`/posts/${p2.id}/block-author`,student,'POST')).status,201);
 assert.equal((await request(`/posts/${p2.id}`,student)).status,404);
});
test('私有材料不能越权访问，只有人工审核通过才获得认证',async()=>{
 const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Pz8AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'proof.png');
 const media=await request('/media?purpose=VERIFICATION',unverified,'POST',form);assert.equal(media.status,201);
 assert.equal((await request('/media/'+media.data.id,peer)).status,403);
 const verify=await request('/verifications/manual',unverified,'POST',{schoolId:'demo-school',materialId:media.data.id});assert.equal(verify.status,201);
 assert.equal((await request(`/admin/verifications/${verify.data.id}/review`,admin,'POST',{approve:true,reason:'测试材料核验通过'})).status,201);
 assert.ok((await request('/me',unverified)).data.memberships.some(m=>m.status==='VERIFIED'));
 assert.equal((await request(`/admin/verifications/${verify.data.id}/review`,admin,'POST',{approve:true,reason:'重复核验'})).status,409);
});
test('封禁立即撤销旧会话，演示登录在生产不可用',async()=>{
 await request('/admin/users/demo-other/ban',admin,'PUT',{banned:true,reason:'测试账号限制'});
 assert.equal((await request('/me',other)).status,401);
 assert.equal((await request('/auth/demo',null,'POST',{role:'other'})).status,403);
 const old=process.env.NODE_ENV;process.env.NODE_ENV='production';assert.equal((await request('/auth/demo',null,'POST',{role:'student'})).status,403);process.env.NODE_ENV=old;
});

test('校级管理员只能审核本校内容且不能追溯匿名身份',async()=>{
 const u=await db.user.upsert({where:{id:'test-school-admin'},create:{id:'test-school-admin',nickname:'校级管理员',role:'SCHOOL_ADMIN',adminSchoolId:'demo-school'},update:{banned:false,deletedAt:null}});
 const token=require('../dist/core/auth').signUser(u),p=await create();
 assert.equal((await request(`/admin/posts/${p.id}/review`,token,'POST',{decision:'APPROVE',reason:'本校内容审核',version:1})).status,201);
 await db.user.update({where:{id:'demo-other'},data:{banned:false}});
 const otherToken=require('../dist/core/auth').signUser(await db.user.findUniqueOrThrow({where:{id:'demo-other'}}));
 const foreign=await create({schoolId:'other-school',campusId:'other-campus'},otherToken);
 assert.equal((await request(`/admin/posts/${foreign.id}/review`,token,'POST',{decision:'APPROVE',reason:'越校审核测试',version:1})).status,403);
 assert.ok(!(await request('/admin/posts',token)).data.some(p=>p.id===foreign.id));
 assert.equal((await request(`/admin/posts/${p.id}/trace`,token,'POST',{reason:'匿名身份查询测试'})).status,403);
 assert.equal((await request('/admin/users/demo-student/ban',token,'PUT',{banned:true,reason:'全局封禁测试'})).status,403);
});

test('订阅授权只消费一次，通知重放与发送结果未知均不重复外发',async()=>{
 process.env.WECHAT_SUBSCRIBE_TEMPLATE='test-template';process.env.WECHAT_SUBSCRIBE_FIELD_MAP=JSON.stringify({title:'thing1',body:'thing2',time:'time3'});
 const service=app.get(require('../dist/identity/identity.module').WechatService),oldToken=service.accessToken,oldFetch=global.fetch;
 let sends=0,fail=false;service.accessToken=async()=> 'test-token';
 global.fetch=async(url,options)=>{if(String(url).includes('api.weixin.qq.com/cgi-bin/message/subscribe/send')){sends++;if(fail)throw new Error('模拟发送超时');assert.equal(JSON.parse(options.body).template_id,'test-template');return {json:async()=>({errcode:0})};}return oldFetch(url,options);};
 try{
  await db.user.update({where:{id:'demo-student'},data:{openid:'test-subscribe-openid'}});
  await db.consent.create({data:{userId:'demo-student',templateId:'test-template',state:'accept'}});
  const e=await db.outbox.create({data:{kind:'NOTIFY',payload:{userId:'demo-student',title:'订阅授权测试',body:'审核结果'}}});
  await tasks.process(e.id);await db.outbox.update({where:{id:e.id},data:{status:'PENDING'}});await tasks.process(e.id);
  const notification=await db.notification.findUniqueOrThrow({where:{eventId:e.id}}),delivery=await db.subscriptionDelivery.findUniqueOrThrow({where:{notificationId:notification.id}});
  assert.equal(await db.subscriptionDelivery.count({where:{notificationId:notification.id}}),1);
  assert.equal(await db.consent.count({where:{userId:'demo-student',state:'consumed'}}),1);
  const send=await db.outbox.findFirstOrThrow({where:{kind:'SEND_SUBSCRIBE',payload:{path:jsonPath('deliveryId'),equals:delivery.id}}});
  await tasks.process(send.id);assert.equal((await db.subscriptionDelivery.findUniqueOrThrow({where:{id:delivery.id}})).status,'SENT');
  await db.outbox.update({where:{id:send.id},data:{status:'PENDING'}});await tasks.process(send.id);assert.equal(sends,1);
  await db.consent.create({data:{userId:'demo-student',templateId:'test-template',state:'accept'}});
  const e2=await db.outbox.create({data:{kind:'NOTIFY',payload:{userId:'demo-student',title:'超时通知测试',body:'测试正文'}}});await tasks.process(e2.id);
  const n2=await db.notification.findUniqueOrThrow({where:{eventId:e2.id}}),d2=await db.subscriptionDelivery.findUniqueOrThrow({where:{notificationId:n2.id}}),s2=await db.outbox.findFirstOrThrow({where:{kind:'SEND_SUBSCRIBE',payload:{path:jsonPath('deliveryId'),equals:d2.id}}});
  fail=true;await tasks.process(s2.id);assert.equal((await db.subscriptionDelivery.findUniqueOrThrow({where:{id:d2.id}})).status,'UNKNOWN');
  await db.outbox.update({where:{id:s2.id},data:{status:'PENDING'}});await tasks.process(s2.id);assert.equal(sends,2);
 }finally{service.accessToken=oldToken;global.fetch=oldFetch;process.env.WECHAT_SUBSCRIBE_TEMPLATE='';process.env.WECHAT_SUBSCRIBE_FIELD_MAP='';await db.user.update({where:{id:'demo-student'},data:{openid:null}});}
});

test('认证材料超过保留期会删除，待审核材料始终保留',async()=>{
 const reviewed=await db.verification.findFirstOrThrow({where:{userId:'demo-unverified',method:'MANUAL',status:'APPROVED'}});
 const old=new Date(Date.now()-10*86400000);
 await db.verification.update({where:{id:reviewed.id},data:{reviewedAt:old}});
 await db.media.update({where:{id:reviewed.materialId},data:{createdAt:old}});
 const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Pz8AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'pending.png');
 const m=await request('/media?purpose=VERIFICATION',peer,'POST',form);assert.equal(m.status,201);
 assert.equal((await request('/verifications/manual',peer,'POST',{schoolId:'demo-school',materialId:m.data.id})).status,201);
 await db.media.update({where:{id:m.data.id},data:{createdAt:old}});
 await app.get(require('../dist/media/media.module').MediaService).cleanup();
 assert.equal(await db.media.findUnique({where:{id:reviewed.materialId}}),null);
 assert.equal((await db.verification.findUniqueOrThrow({where:{id:reviewed.id}})).materialId,null);
 assert.ok(await db.media.findUnique({where:{id:m.data.id}}));
});

test('公开帖子图片允许作者、同校学生与管理员查看，拒绝游客和跨校用户',async()=>{
 const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Pz8AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'post.png');
 const m=await request('/media?purpose=POST',student,'POST',form);assert.equal(m.status,201);
 const p=await create({mediaIds:[m.data.id]});await approve(p.id);
 assert.equal((await request('/media/'+m.data.id,admin)).status,200);
 assert.equal((await request('/media/'+m.data.id,peer)).status,200);
 assert.equal((await request('/media/'+m.data.id,null)).status,403);
 const foreign=require('../dist/core/auth').signUser(await db.user.findUniqueOrThrow({where:{id:'demo-other'}}));
 assert.equal((await request('/media/'+m.data.id,foreign)).status,403);
 const membership=await db.membership.findUniqueOrThrow({where:{userId_schoolId:{userId:'demo-student',schoolId:'demo-school'}}});
 try{
  await db.membership.update({where:{id:membership.id},data:{expiresAt:new Date(0)}});
  assert.equal((await request('/media/'+m.data.id,student)).status,200);
 }finally{await db.membership.update({where:{id:membership.id},data:{expiresAt:membership.expiresAt}});}
});

test('大量待审材料不会阻塞其他到期上传的清理',async()=>{
 const old=new Date(Date.now()-20*86400000);
 const rows=Array.from({length:100},()=>({id:randomUUID(),userId:'demo-peer',purpose:'VERIFICATION',key:randomUUID(),mime:'image/png',size:1,createdAt:old}));
 await db.media.createMany({data:rows});
 await db.verification.createMany({data:rows.map(m=>({userId:'demo-peer',schoolId:'demo-school',method:'MANUAL',materialId:m.id,status:'PENDING'}))});
 const unused=await db.media.create({data:{userId:'demo-peer',purpose:'POST',key:randomUUID(),mime:'image/png',size:1,createdAt:new Date(Date.now()-5*86400000)}});
 await app.get(require('../dist/media/media.module').MediaService).cleanup();
 assert.equal(await db.media.findUnique({where:{id:unused.id}}),null);
 assert.equal(await db.media.count({where:{id:{in:rows.map(m=>m.id)}}}),100);
});
