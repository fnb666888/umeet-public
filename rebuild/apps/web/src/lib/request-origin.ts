export function allowedRequestOrigin(origin:string|null):boolean{
 const configured=process.env.PUBLIC_WEB_ORIGIN;
 const allowed=configured?[new URL(configured).origin]:process.env.NODE_ENV==='production'?[]:['http://127.0.0.1:5178','http://localhost:5178'];
 return origin!==null&&allowed.includes(origin);
}
