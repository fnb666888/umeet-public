export async function GET(){
  if(process.env.TURNSTILE_ENABLED==='true'&&!process.env.TURNSTILE_SITE_KEY)return Response.json({error:'Verification unavailable'},{status:503});
  return Response.json({sitekey:process.env.TURNSTILE_ENABLED==='true'?process.env.TURNSTILE_SITE_KEY||null:null},{headers:{'Cache-Control':'no-store'}});
}
