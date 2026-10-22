import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("native metered meeting end performs confirmed provider disconnect before all local writes",async()=>{
 const src=await readFile(new URL("./meeting-live.ts",import.meta.url),"utf8");
 const start=src.indexOf('router.post("/meetings/native/:room/end"');
 const finish=src.indexOf('router.post("/meetings/native/:room/control"',start);
 assert.ok(start>=0&&finish>start,"native room end route must exist");
 const route=src.slice(start,finish);
 const requireProvider=route.indexOf('await requireSchoolOSPrepaidRoomDisconnect(');
 const deleteRoom=route.indexOf('() => livekitRoomService("DeleteRoom", { room }, room)');
 const recordingWrite=route.indexOf('await prisma.meetingRecording.update(');
 const attendanceWrite=route.indexOf('await closeOpenAttendance(meeting.id)');
 const meetingWrite=route.indexOf('await prisma.meeting.update(');
 assert.match(route,/schoolOSVideoAdmissionEnabled\(org\(req\)\) \|\|[\s\S]*?await schoolOSVideoRoomHasPrepaidHistory\(org\(req\),meeting\.id\)/);
 assert.ok(route.indexOf("schoolOSVideoRoomHasPrepaidHistory")<requireProvider,
  "previous prepaid reservation must still demand confirmed provider closure after opt-out");
 assert.ok(requireProvider>=0&&deleteRoom>requireProvider);
 assert.ok(requireProvider<recordingWrite,"do not claim recording completed if provider disconnect fails");
 assert.ok(requireProvider<attendanceWrite,"do not claim attendance ended if room remains");
 assert.ok(requireProvider<meetingWrite,"do not close meeting while provider remains active");
 assert.ok(route.includes('if (!meteredRoom) await livekitRoomService("DeleteRoom", { room }, room).catch(() => null);'),
  "unmetered V4 semantics remain best-effort and isolated");
});
test("expired prepaid room worker can retry a failed host-initiated provider disconnect",async()=>{
 const [route,worker,candidates]=await Promise.all([
  readFile(new URL("./meeting-live.ts",import.meta.url),"utf8"),
  readFile(new URL("../lib/schoolos-video-expiry-worker.ts",import.meta.url),"utf8"),
  readFile(new URL("../lib/schoolos-video-expired-candidates.ts",import.meta.url),"utf8"),
 ]);
 assert.match(route,/SCHOOLOS_VIDEO_PROVIDER_END_UNCONFIRMED|requireSchoolOSPrepaidRoomDisconnect/);
 assert.match(worker,/requireSchoolOSPrepaidRoomDisconnect\(/);
 assert.ok(worker.indexOf('await requireSchoolOSPrepaidRoomDisconnect(')<worker.indexOf("await systemPrisma.$transaction("));
 assert.match(candidates,/m\."status" IN \('SCHEDULED','OPEN_FOR_JOIN','LIVE'\)/);
 assert.match(candidates,/r\."status"='RESERVED'/);
});
