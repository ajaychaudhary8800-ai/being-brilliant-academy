import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
const src=(name:string)=>readFile(new URL(name,import.meta.url),"utf8");

test("new LiveKit meeting tokens and join paths are quota gated before provider admission",async()=>{
 const route=await src("./meeting-live.ts");
 const session=route.slice(route.indexOf('router.post("/meetings/native/:room/session"'),
  route.indexOf('router.post("/meetings/native/:room/join"'));
 const join=route.slice(route.indexOf('router.post("/meetings/native/:room/join"'),
  route.indexOf('router.post("/meetings/native/:room/leave"'));
 assert.match(session,/authorizeSchoolOSPrepaidVideoRoom\(org\(req\), meeting\.id\)/);
 assert.ok(session.indexOf("authorizeSchoolOSPrepaidVideoRoom")<session.indexOf("createLiveKitToken"));
 assert.match(session,/ttlSeconds: videoAdmission\.tokenTtlSeconds/);
 assert.match(join,/authorizeSchoolOSPrepaidVideoRoom\(org\(req\), meeting\.id\)/);
 assert.ok(join.indexOf("authorizeSchoolOSPrepaidVideoRoom")<join.indexOf("meetingAttendanceSession.findFirst"));
 assert.ok(join.indexOf("MEETING_CONCURRENT_ROOM_LIMIT")<join.indexOf("authorizeSchoolOSPrepaidVideoRoom"));
 assert.match(session,/schoolOSVideoAdmissionEnabled\(org\(req\)\)/);
 assert.ok(session.indexOf("MEETING_CONCURRENT_ROOM_LIMIT")<session.indexOf("authorizeSchoolOSPrepaidVideoRoom"));
});
test("prepaid room admission and settlement are both independently disabled by default",async()=>{
 const config=await src("../config.ts"),admission=await src("../lib/schoolos-video-admission.ts");
 const settlement=await src("../lib/schoolos-video-review-service.ts");
 assert.match(config,/SCHOOLOS_VIDEO_ADMISSION_ENABLED: z\.string\(\)\.default\("false"\)/);
 assert.match(config,/SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS: optionalString/);
 assert.match(admission,/env\.SCHOOLOS_VIDEO_SETTLEMENT_ENABLED/);
 assert.match(admission,/env\.SCHOOLOS_VIDEO_WEBHOOK_ENABLED/);
 assert.match(admission,/pg_advisory_xact_lock/);
 assert.match(settlement,/SCHOOLOS_VIDEO_RESERVATION_MISSING/);
 assert.match(settlement,/SCHOOLOS_VIDEO_RESERVED_BUDGET_EXCEEDED/);
 assert.match(settlement,/unusedMinutesRestored:difference/);
 assert.doesNotMatch(admission,/razorpay|charge\(/i);
});
test("database allows bounded room credit holds while retaining prior AI one-unit restrictions",async()=>{
 const migration=await src("../../prisma/migrations/20261019070000_schoolos_video_minute_reservations/migration.sql");
 assert.match(migration,/"metric"='ai_credits' AND "units"=1/);
 assert.match(migration,/"metric"='video_minutes' AND "units" BETWEEN 1 AND 240/);
 assert.match(migration,/requestKey" LIKE 'video-meeting:%'/);
});
