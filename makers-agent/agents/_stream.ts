export function sse(data:unknown){return "data: "+JSON.stringify(data)+"\n\n";}
export function streamResponse(generate:(signal:AbortSignal)=>AsyncGenerator<string>,parent?:AbortSignal){
  const abort=new AbortController(); const stop=()=>abort.abort();
  if(parent?.aborted)stop();else parent?.addEventListener("abort",stop,{once:true});
  const encoder=new TextEncoder();let closed=false;
  const body=new ReadableStream<Uint8Array>({
    async start(controller){
      const send=(text:string)=>{if(!closed)controller.enqueue(encoder.encode(text));};
      const heartbeat=setInterval(()=>{if(!abort.signal.aborted)send(sse({type:"ping",ts:Date.now()}));},5000);
      const timeout=setTimeout(stop,40000);
      try{
        for await(const text of generate(abort.signal)){if(abort.signal.aborted)break;send(text);}
        if(!abort.signal.aborted)send("data: [DONE]\n\n");
        else if(!parent?.aborted)send(sse({type:"error_message",content:"AGENT_TIMEOUT"}));
      }catch{if(!abort.signal.aborted){send(sse({type:"error_message",content:"AGENT_EXECUTION_FAILED"}));send("data: [DONE]\n\n");}}
      finally{clearInterval(heartbeat);clearTimeout(timeout);parent?.removeEventListener("abort",stop);if(!closed){closed=true;controller.close();}}
    },cancel(){closed=true;stop();},
  });
  return new Response(body,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive","X-Accel-Buffering":"no"}});
}
