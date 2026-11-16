export function apiUrl(path:string):string{
 const root=process.env.API_BASE_URL||'http://127.0.0.1:3188/api/v1';
 const parsed=new URL(root);
 if(!['http:','https:'].includes(parsed.protocol))throw new Error('API_BASE_URL_INVALID');
 return root.replace(/\/$/,'')+path;
}
export async function publicApi<T>(path:string):Promise<T>{
 const result=await fetch(apiUrl(path),{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!result.ok)throw new Error('API_UNAVAILABLE');return result.json() as Promise<T>;
}
export type Community={id:string;slug:string;name:string;description:string;is_default:number};
