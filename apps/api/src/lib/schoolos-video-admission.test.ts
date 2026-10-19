import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./http.js";
import {
 schoolOSVideoAdmissionEnabled,schoolOSVideoReservationWindow,
 schoolOSVideoReservationKey,SCHOOL_OS_VIDEO_MAX_PREAUTHORIZED_MINUTES,
 authorizeSchoolOSPrepaidVideoRoom,
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
