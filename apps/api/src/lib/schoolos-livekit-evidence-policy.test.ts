import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import test from "node:test";
import { verifySchoolOSLiveKitWebhook,calculateSchoolOSVideoRoomMinutes } from "./schoolos-livekit-evidence-policy.js";
const key="qa-livekit-key",secret="qa-livekit-secret-long-enough-for-hmac";
const body=Buffer.from(JSON.stringify({id:"provider-event-001",event:"participant_joined",
 createdAt:1792300000,room:{name:"meeting-livekit-12345"},participant:{identity:"host",sid:"PA-001"}}));
function signature(payload:Buffer,override?:Record<string,unknown>){
 return jwt.sign({iss:key,sha256:crypto.createHash("sha256").update(payload).digest("base64"),...override},
  secret,{algorithm:"HS256",expiresIn:"10m"});
}
test("LiveKit signed raw webhook is verified with issuer + binary sha256 and is tamper-proof",()=>{
 const token=signature(body);
 const e=verifySchoolOSLiveKitWebhook(body,token,key,secret);
 assert.equal(e?.eventId,"provider-event-001");
 assert.equal(e?.eventType,"participant_joined");
 assert.equal(e?.identity,"host");
 assert.equal(e?.roomName,"meeting-livekit-12345");
 assert.match(e?.bodySha256??"",/^[a-f0-9]{64}$/);
 assert.throws(()=>verifySchoolOSLiveKitWebhook(Buffer.from(body.toString().replace("host","attacker")),token,key,secret));
 assert.throws(()=>verifySchoolOSLiveKitWebhook(body,signature(body,{iss:"foreign-key"}),key,secret));
 assert.throws(()=>verifySchoolOSLiveKitWebhook(body,undefined,key,secret));
 assert.throws(()=>verifySchoolOSLiveKitWebhook(body,token,key,undefined));
});
test("non-metering provider event cannot be misinterpreted as billable room usage",()=>{
 const payload=Buffer.from(JSON.stringify({...JSON.parse(body.toString()),event:"track_published"}));
 assert.equal(verifySchoolOSLiveKitWebhook(payload,signature(payload),key,secret),null);
});
const t=(s:number)=>new Date(1792300000*1000+s*1000);
const row=(eventType:string,identity:string|null,participantSid:string|null,seconds:number)=>
 ({eventType,identity,participantSid,occurredAt:t(seconds)});
test("video preview uses overlapping connected room time, counts rooms not participants",()=>{
 const r=calculateSchoolOSVideoRoomMinutes([
  row("participant_joined","host","h",0),
  row("participant_joined","student1","s1",10),
  row("participant_joined","student2","s2",20),
  row("participant_left","student1","s1",90),
  row("participant_left","student2","s2",130),
  row("participant_left","host","h",150),
  row("room_finished",null,null,160),
 ],"host");
 assert.deepEqual(r,{status:"PREVIEW_ONLY",seconds:120,minutes:2,reason:null});
});
test("no two-party presence means no paid room minute",()=>{
 const r=calculateSchoolOSVideoRoomMinutes([
  row("participant_joined","host","h",0),row("participant_left","host","h",40),
  row("room_finished",null,null,45)],"host");
 assert.equal(r.status,"PREVIEW_ONLY");assert.equal(r.minutes,0);
});
test("unpaired, duplicate, provider-incomplete and missing room-finished evidence fails closed",()=>{
 const cases=[
  [row("participant_joined","host","h",0)],
  [row("participant_joined","host","h",0),row("participant_joined","host","h",2),row("room_finished",null,null,5)],
  [row("participant_left","host","h",1),row("room_finished",null,null,2)],
  [row("participant_joined","host","h",0),row("room_finished",null,null,2)],
 ];
 for(const c of cases){
  const r=calculateSchoolOSVideoRoomMinutes(c,"host");
  assert.equal(r.status,"RECONCILIATION_REQUIRED");
  assert.equal(r.minutes,null);
 }
});
