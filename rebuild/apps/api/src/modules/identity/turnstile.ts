import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
export async function verifyTurnstile(token:unknown, env:NodeJS.ProcessEnv=process.env, fetcher:typeof fetch=fetch){
  if(env.TURNSTILE_ENABLED!=="true")return;
  if(!env.TURNSTILE_SECRET_KEY||!env.TURNSTILE_HOSTNAME)throw new ServiceUnavailableException("HUMAN_VERIFICATION_UNAVAILABLE");
  if(typeof token!=="string"||!token||token.length>2048)throw new BadRequestException("HUMAN_VERIFICATION_REQUIRED");
  let data:{success?:boolean;hostname?:string;action?:string};
  try{const response=await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token}),signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error();data=await response.json() as typeof data;
  }catch{throw new ServiceUnavailableException("HUMAN_VERIFICATION_UNAVAILABLE");}
  if(data.success!==true||data.hostname!==env.TURNSTILE_HOSTNAME||data.action!=="otp_request")throw new BadRequestException("HUMAN_VERIFICATION_FAILED");
}
