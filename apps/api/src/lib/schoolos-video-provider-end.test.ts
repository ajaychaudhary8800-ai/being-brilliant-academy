import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./http.js";
import { requireSchoolOSPrepaidRoomDisconnect } from "./schoolos-video-provider-end.js";

test("confirmed provider room deletion allows prepaid room closure",async()=>{
 let calls=0;
 await requireSchoolOSPrepaidRoomDisconnect(async()=>{calls++;return {success:true};});
 assert.equal(calls,1);
});
test("provider refusal, timeouts or ambiguous outcomes fail closed with retryable 503",async()=>{
 for(const error of [
  new Error("LiveKit returned HTTP 503"),
  new Error("request timeout"),
  new Error("provider permission denied"),
  "ambiguous provider response",
 ]){
  await assert.rejects(
   ()=>requireSchoolOSPrepaidRoomDisconnect(async()=>{throw error;}),
   (reason:unknown)=>reason instanceof AppError &&
     reason.status===503 && reason.code==="SCHOOLOS_VIDEO_PROVIDER_END_UNCONFIRMED",
  );
 }
});
