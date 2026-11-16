import {S3Client,PutObjectCommand,GetObjectCommand} from "@aws-sdk/client-s3";
import {Agent} from 'node:https';
function client(env:NodeJS.ProcessEnv){
  if(!env.R2_ACCOUNT_ID||!env.R2_ACCESS_KEY_ID||!env.R2_SECRET_ACCESS_KEY||!env.R2_BUCKET)throw new Error("R2_CONFIGURATION_INCOMPLETE");
  return new S3Client({region:"auto",endpoint:"https://"+env.R2_ACCOUNT_ID+".r2.cloudflarestorage.com",credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},maxAttempts:2,requestHandler:{httpsAgent:new Agent({family:4}),connectionTimeout:10000,requestTimeout:15000}});
}
export async function putAsset(id:string,data:string,env:NodeJS.ProcessEnv=process.env){
  if(env.ASSET_STORAGE!=="r2")return false;
  const match=/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if(!match)throw new Error("INVALID_IMAGE");
  const body=Buffer.from(match[2]!,"base64");if(body.length>5*1024*1024)throw new Error("IMAGE_TOO_LARGE");
  const s3=client(env);try{await s3.send(new PutObjectCommand({Bucket:env.R2_BUCKET,Key:"images/"+id,Body:body,ContentType:match[1],CacheControl:"public, max-age=31536000, immutable"}),{abortSignal:AbortSignal.timeout(15000)});}finally{s3.destroy();}
  return true;
}
export async function readAsset(id:string,env:NodeJS.ProcessEnv=process.env){
  const s3=client(env);try{
    const result=await s3.send(new GetObjectCommand({Bucket:env.R2_BUCKET,Key:"images/"+id}),{abortSignal:AbortSignal.timeout(15000)});
    if(!result.Body||!/^image\/(png|jpeg|gif|webp)$/.test(result.ContentType||""))throw new Error("INVALID_IMAGE");
    if((result.ContentLength||0)>5*1024*1024)throw new Error("IMAGE_TOO_LARGE");
    return {type:result.ContentType!,body:Buffer.from(await result.Body.transformToByteArray())};
  }finally{s3.destroy();}
}
