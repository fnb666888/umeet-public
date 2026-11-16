const {test}=require('node:test');
const assert=require('node:assert/strict');
const COS=require('cos-nodejs-sdk-v5');
const {WxcloudCos}=require('../dist/media/wxcloud-cos');

test('COS 私有文件被匿名读取时拒绝保存并清理对象，凭据不返回客户端',async()=>{
 const originalFetch=global.fetch,put=COS.prototype.putObject,remove=COS.prototype.deleteObject;
 const prior={COS_BUCKET:process.env.COS_BUCKET,COS_REGION:process.env.COS_REGION};
 let deleted=0,authCalls=0,anonymousStatus=200;
 process.env.COS_BUCKET='test-bucket';process.env.COS_REGION='ap-shanghai';
 COS.prototype.putObject=async params=>{assert.equal(params.ACL,'private');assert.match(params.Key,/^umeet\/private\//);};
 COS.prototype.deleteObject=async()=>{deleted++;};
 global.fetch=async(url)=>{
  if(String(url).includes('/_/cos/getauth')){authCalls++;return {ok:true,json:async()=>({TmpSecretId:'test-only-id',TmpSecretKey:'test-only-key',Token:'test-only-token',ExpiredTime:Math.floor(Date.now()/1000)+3600})};}
  return {status:anonymousStatus};
 };
 try{
  const cos=new WxcloudCos();
  await assert.rejects(cos.put('test-file',Buffer.from('test'),'image/png'),/匿名访问/);
  assert.equal(deleted,1);
  anonymousStatus=403;
  assert.equal(await cos.put('private-file',Buffer.from('test'),'image/png'),undefined);
  assert.equal(authCalls,1);
 }finally{global.fetch=originalFetch;COS.prototype.putObject=put;COS.prototype.deleteObject=remove;for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
