import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./http.js";
import { env } from "../config.js";
import {
 schoolOSVideoAdmissionEnabled,schoolOSVideoReservationWindow,
 schoolOSVideoReservationKey,SCHOOL_OS_VIDEO_MAX_PREAUTHORIZED_MINUTES,
 authorizeSchoolOSPrepaidVideoRoom,assertSchoolOSNativeLiveClassAdmissionAllowed,
} from "./schoolos-video-admission.js";

const meeting={startsAt:new Date("2026-10-19T08:00:00.000Z"),endsAt:new Date("2026-10-19T09:00:00.000Z")};
test("payment-impacting LiveKit quota holds remain disabled by default",async()=>{
 assert.equal(schoolOSVideoAdmissionEnabled("tenant-false"),false);
 assert.equal(schoolOSVideoAdmissionEnabled("org_default"),false);
 const admission=await authorizeSchoolOSPrepaidVideoRoom("tenant-false","valid-meeting-identifier");
 assert.equal(admission.enforced,false);
 assert.equal(admission.heldMinutes,0);
 assert.equal(admission.admitted,true);
});
test("signed room time window reserves planned duration plus ten-minute opening buffer",()=>{
 const a=schoolOSVideoReservationWindow(meeting,new Date("2026-10-19T08:15:00Z"));
 assert.equal(a.units,70);
 assert.equal(a.tokenTtlSeconds,45*60);
 assert.equal(a.preauthorizedFrom.toISOString(),"2026-10-19T07:50:00.000Z");
 assert.equal(a.preauthorizedUntil.toISOString(),"2026-10-19T09:00:00.000Z");
 assert.equal(schoolOSVideoReservationKey("m-123"),"video-meeting:m-123");
 assert.equal(SCHOOL_OS_VIDEO_MAX_PREAUTHORIZED_MINUTES,240);
});
test("unauthorized early, late, and oversized room windows must fail closed",()=>{
 const cases=[
 [meeting,new Date("2026-10-19T07:49:59Z")],
 [meeting,new Date("2026-10-19T09:00:00Z")],
 [{startsAt:meeting.startsAt,endsAt:new Date("2026-10-19T13:00:00Z")},
  new Date("2026-10-19T08:10:00Z")],
 [{startsAt:meeting.endsAt,endsAt:meeting.startsAt},
  new Date("2026-10-19T08:10:00Z")],
 ] as const;
 for(const [times,now] of cases){
  assert.throws(()=>schoolOSVideoReservationWindow(times,now),(err:unknown)=>err instanceof AppError);
 }
});

test("native LMS LiveKit admission never bypasses enabled paid video holds, but V4 remains unchanged",()=>{
 const tenant="unit-video-paid-coaching";
 const names=[
  "SCHOOLOS_VIDEO_ADMISSION_ENABLED","SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS",
  "SCHOOLOS_VIDEO_SETTLEMENT_ENABLED","SCHOOLOS_VIDEO_SETTLEMENT_TENANT_IDS",
  "SCHOOLOS_VIDEO_WEBHOOK_ENABLED","SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS",
 ] as const;
 const previous=Object.fromEntries(names.map(k=>[k,env[k]]));
 try{
  env.SCHOOLOS_VIDEO_ADMISSION_ENABLED=true;
  env.SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS=tenant;
  env.SCHOOLOS_VIDEO_SETTLEMENT_ENABLED=true;
  env.SCHOOLOS_VIDEO_SETTLEMENT_TENANT_IDS=tenant;
  env.SCHOOLOS_VIDEO_WEBHOOK_ENABLED=true;
  env.SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS=tenant;
  assert.equal(schoolOSVideoAdmissionEnabled(tenant),true);
  assert.throws(()=>assertSchoolOSNativeLiveClassAdmissionAllowed(tenant),
   (error:unknown)=>error instanceof AppError&&error.status===409&&
     error.code==="SCHOOLOS_VIDEO_NATIVE_CLASS_UNMETERED");
  assert.doesNotThrow(()=>assertSchoolOSNativeLiveClassAdmissionAllowed("org_default"));
  assert.doesNotThrow(()=>assertSchoolOSNativeLiveClassAdmissionAllowed("other-nonpaid-school"));
  env.SCHOOLOS_VIDEO_WEBHOOK_ENABLED=false;
  assert.equal(schoolOSVideoAdmissionEnabled(tenant),false);
  assert.doesNotThrow(()=>assertSchoolOSNativeLiveClassAdmissionAllowed(tenant),
   "Legacy admission remains unchanged when paid video admission is inactive");
 }finally{
  for(const k of names)(env as unknown as Record<string,unknown>)[k]=previous[k];
 }
});
