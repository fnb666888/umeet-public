import { z } from "zod";
export const Prompt = z.strictObject({
  question:z.string().trim().min(5).max(1000), rules:z.string().trim().min(5).max(5000),
  informationAt:z.iso.datetime({offset:true}),
  evidence:z.array(z.strictObject({id:z.string().min(1).max(100),title:z.string().min(1).max(500),url:z.url().max(2000),excerpt:z.string().min(1).max(6000),fetchedAt:z.iso.datetime({offset:true})})).min(1).max(20),
}).superRefine((v,ctx)=>{
  if(new Set(v.evidence.map(e=>e.id)).size!==v.evidence.length) ctx.addIssue({code:"custom",message:"Duplicate evidence ID"});
  if(v.evidence.some(e=>Date.parse(e.fetchedAt)>Date.parse(v.informationAt))) ctx.addIssue({code:"custom",message:"Evidence exceeds cutoff"});
});
export const Output=z.strictObject({probability:z.number().min(0).max(1),reasoning:z.string().trim().min(20).max(5000),counterEvidence:z.string().trim().min(5).max(3000),evidenceIds:z.array(z.string().min(1).max(100)).min(1).max(20)});
export function parseOutput(text:string,ids:Set<string>){
  const result=Output.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")));
  if(result.evidenceIds.some(id=>!ids.has(id))) throw new Error("Unknown evidence ID");
  return result;
}
