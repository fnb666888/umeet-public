import {NextResponse,type NextRequest} from 'next/server';
import {cookies} from 'next/headers';
import {apiUrl} from '../../../../lib/api';
import {allowedRequestOrigin} from '../../../../lib/request-origin';
import {browserHeaders} from '../../../../lib/browser-accounts-server';
type Context={params:Promise<{path:string[]}>};
async function proxy(request:NextRequest,context:Context){
 const {path}=await context.params;
 const write=!['GET','HEAD'].includes(request.method);
 const communityList=!write&&path.length===1&&path[0]==='communities';
 if(!communityList&&(!path.length||!['records','wiki','knowledge','discussions','demo','account','messages','admin','governance','community-governance','interest'].includes(path[0]||'')||path.length>(path[0]==='interest'?5:['demo','admin','knowledge'].includes(path[0]||'')?4:3)||path.some(part=>!part||part==='.'||part==='..'||/[\/\\?#]/.test(part))))return NextResponse.json({message:'不存在的接口'},{status:404});
 if(write&&!allowedRequestOrigin(request.headers.get('origin')))return NextResponse.json({message:'请求来源不匹配'},{status:403});
 const store=await cookies();
 const token=store.get('umeet_session')?.value;
 if(!token&&(write||path[0]==='records'))return NextResponse.json({message:'请先登录或使用游客身份'},{status:401});
 let body:string|undefined;
 if(write&&request.method!=='DELETE'){
  try{body=JSON.stringify(await request.json());}catch{return NextResponse.json({message:'请求内容格式有误'},{status:400});}
 }
 try{
  const response=await fetch(apiUrl('/'+path.map(encodeURIComponent).join('/')+request.nextUrl.search),{method:request.method,headers:{'Content-Type':'application/json',...browserHeaders(request,store),...(token?{Authorization:'Bearer '+token}:{}),...(path[0]==='knowledge'&&request.headers.get('X-Knowledge-Account')?{'X-Knowledge-Account':request.headers.get('X-Knowledge-Account')!}:{})},...(body?{body}:{}),cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!write&&path[0]==='demo'&&path[1]==='assets'&&response.ok){
   return new NextResponse(await response.arrayBuffer(),{headers:{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=31536000, immutable'}});
  }
  const data:unknown=await response.json();
  if(response.ok&&write&&path.join('/')==='account/close')store.delete('umeet_session');
  return NextResponse.json(data,{status:response.status,headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({message:'服务暂时不可用，请稍后重试'},{status:503});}
}
export const GET=proxy;export const POST=proxy;export const PUT=proxy;export const DELETE=proxy;
