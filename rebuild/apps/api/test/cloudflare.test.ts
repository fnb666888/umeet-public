import {describe,it,expect,vi} from "vitest";
import {verifyTurnstile} from "../src/modules/identity/turnstile.js";
import {putAsset} from "../src/modules/demo/r2-assets.js";
import {OtpRequestSchema} from '../../../packages/contracts/src/auth.js';
describe("Cloudflare integration",()=>{
 it('accepts a verification token while rejecting account injection',()=>{
  const body={channel:'email',recipient:'reader@example.com',turnstileToken:'token'};
  expect(OtpRequestSchema.safeParse(body).success).toBe(true);
  expect(OtpRequestSchema.safeParse({...body,userId:'another-user'}).success).toBe(false);
 });
 const env={TURNSTILE_ENABLED:"true",TURNSTILE_SECRET_KEY:"secret",TURNSTILE_HOSTNAME:"example.com"};
 it("rejects missing human verification",async()=>{await expect(verifyTurnstile(undefined,env)).rejects.toThrow("HUMAN_VERIFICATION_REQUIRED");});
 it("checks action and hostname",async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,hostname:"other.example",action:"otp_request"}));
  await expect(verifyTurnstile("token",env,fetcher)).rejects.toThrow("HUMAN_VERIFICATION_FAILED");
  fetcher.mockResolvedValue(Response.json({success:true,hostname:"example.com",action:"otp_request"}));
  await expect(verifyTurnstile("token",env,fetcher)).resolves.toBeUndefined();
 });
 it("does not bypass service failures",async()=>{await expect(verifyTurnstile("token",env,vi.fn().mockRejectedValue(new Error()))).rejects.toThrow("HUMAN_VERIFICATION_UNAVAILABLE");});
 it("keeps database storage unless R2 is enabled",async()=>{expect(await putAsset("id","data",{})).toBe(false);});
 it("rejects unsupported image data before upload",async()=>{await expect(putAsset("id","data:image/svg+xml;base64,abc",{ASSET_STORAGE:"r2"})).rejects.toThrow("INVALID_IMAGE");});
});
