type Turnstile={render:(container:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void};
let loading:Promise<void>|undefined;
export async function humanVerification():Promise<string|undefined>{
  const response=await fetch('/api/verification/config',{cache:'no-store'});
  if(!response.ok)throw new Error('验证服务暂不可用，请重试');
  const {sitekey}=await response.json() as {sitekey:string|null};if(!sitekey)return;
  const win=window as unknown as {turnstile?:Turnstile};
  if(!win.turnstile){
    loading??=new Promise<void>((resolve,reject)=>{const script=document.createElement('script');const fail=()=>{clearTimeout(timer);script.remove();loading=undefined;reject(new Error('无法加载人机验证，请检查网络后重试'));};const timer=setTimeout(fail,15000);script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.onload=()=>{clearTimeout(timer);win.turnstile?resolve():fail();};script.onerror=fail;document.head.append(script);});
    await loading;
  }
  return new Promise((resolve,reject)=>{
    const dialog=document.createElement('dialog');const text=document.createElement('p');text.textContent='请完成验证后发送验证码';const container=document.createElement('div');const close=document.createElement('button');close.type='button';close.textContent='取消';dialog.append(text,container,close);document.body.append(dialog);dialog.showModal();
    let widget:string|undefined;let finished=false;
    const finish=(token?:string)=>{if(finished)return;finished=true;clearTimeout(timer);if(widget)win.turnstile?.remove(widget);dialog.close();dialog.remove();token?resolve(token):reject(new Error('验证未完成，请重试'));};
    const timer=setTimeout(()=>finish(),120000);close.onclick=()=>finish();dialog.oncancel=event=>{event.preventDefault();finish();};
    try{widget=win.turnstile!.render(container,{sitekey,action:'otp_request',callback:(token:string)=>finish(token),'error-callback':()=>finish(),'expired-callback':()=>finish()});}catch{finish();}
  });
}
