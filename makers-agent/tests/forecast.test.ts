import {test} from "node:test";
import assert from "node:assert/strict";
import {onRequest} from "../agents/forecast";
import {parseOutput,Prompt} from "../agents/_contract";
import {streamResponse,sse} from "../agents/_stream";
test("rejects missing credentials before model calls",async()=>{assert.equal((await onRequest({env:{UMEET_AGENT_TOKEN:"secret"},request:{method:"POST",headers:{}}})).status,401);});
test("fails closed when authentication is not configured",async()=>{assert.equal((await onRequest({request:{method:"POST"}})).status,503);});
test("requires conversation routing header",async()=>{assert.equal((await onRequest({env:{UMEET_AGENT_TOKEN:"secret"},request:{method:"POST",headers:{authorization:"Bearer secret"}}})).status,400);});
test("validates probability and citations",()=>{
 const value={probability:0.6,reasoning:"现有证据支持这一可能性，但仍然存在显著的不确定性。",counterEvidence:"相反证据仍然不足。",evidenceIds:["a"]};
 assert.deepEqual(parseOutput(JSON.stringify(value),new Set(["a"])),value);
 assert.throws(()=>parseOutput(JSON.stringify(value),new Set(["b"])));
 assert.throws(()=>parseOutput(JSON.stringify({...value,probability:2}),new Set(["a"])));
});
test("rejects evidence after information cutoff",()=>{assert.equal(Prompt.safeParse({question:"会发布新版本吗？",rules:"以官方发布公告为准",informationAt:"2026-11-15T00:00:00Z",evidence:[{id:"a",title:"公告",url:"https://example.com",excerpt:"资料",fetchedAt:"2026-11-16T00:00:00Z"}]}).success,false);});
test("stream completes and hides internal errors",async()=>{
 const ok=await streamResponse(async function*(){yield sse({type:"ai_response",content:"ok"});}).text();assert.ok(ok.includes("data: [DONE]"));
 const failed=await streamResponse(async function*(){throw new Error("private-secret");}).text();assert.ok(failed.includes("AGENT_EXECUTION_FAILED"));assert.ok(!failed.includes("private-secret"));
});
