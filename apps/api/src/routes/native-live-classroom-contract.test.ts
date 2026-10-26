import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = new URL("./learning-ecosystem.ts", import.meta.url);
const schema = new URL("../../prisma/schema.prisma", import.meta.url);
const livekit = new URL("../lib/livekit.ts", import.meta.url);

test("native live classroom is a first-class provider with protected session tokens", async () => {
  const [source, prisma, helper] = await Promise.all([
    readFile(route, "utf8"),
    readFile(schema, "utf8"),
    readFile(livekit, "utf8"),
  ]);
  assert.match(prisma, /enum LiveClassProvider[\s\S]*NATIVE/);
  assert.match(source, /LiveClassProvider\.NATIVE/);
  assert.match(source, /\/learning\/live-classes\/native\/:room\/session/);
  assert.match(source, /createLiveKitToken/);
  assert.match(source, /canPublishSources: manager \? \["camera", "microphone", "screen_share", "screen_share_audio"\] : \["camera", "microphone"\]/);
  assert.match(helper, /HS256/);
  assert.match(helper, /roomAdmin/);
});

test("native classroom exposes moderation, whiteboard and recording controls", async () => {
  const source = await readFile(route, "utf8");
  for (const expected of [
    "MUTE_TRACK",
    "REMOVE_PARTICIPANT",
    "ALLOW_SCREEN_SHARE",
    "REVOKE_SCREEN_SHARE",
    "ROOM_LOCK",
    "SAVE_WHITEBOARD",
    "StartEgress",
    "StopEgress",
  ]) assert.match(source, new RegExp(expected));
  assert.match(source, /recordingObjectKey/);
  assert.match(source, /getLiveKitRecordingObject\(live\.recordingObjectKey\)/);
});


test("completed native recordings publish to LMS without copying large video bytes into PostgreSQL", async () => {
  const [source, prisma] = await Promise.all([readFile(route, "utf8"), readFile(schema, "utf8")]);
  assert.match(prisma, /storageKey\s+String\?/);
  assert.match(prisma, /sourceLiveClassId\s+String\?/);
  assert.match(source, /ensureRecordingMaterial/);
  assert.match(source, /StudyMaterialType\.VIDEO/);
  assert.match(source, /storageKey: live\.recordingObjectKey/);
  assert.match(source, /publishedToLms/);
  assert.match(source, /row\.storageKey/);
});


test("attendance close is idempotent for explicit leave and browser-exit retries", async () => {
  const source = await readFile(route, "utf8");
  assert.match(source, /if \(row\.leftAt\) return res\.json\(\{ data: row \}\)/);
});

test("paid-video tenants cannot bypass Meetings quota through native LMS tokens or attendance",async()=>{
 const source=await readFile(route,"utf8");
 const policy=await readFile(new URL("../lib/schoolos-video-admission.ts",import.meta.url),"utf8");
 const session=source.slice(source.indexOf('router.post("/learning/live-classes/native/:room/session"'),
   source.indexOf('router.post("/learning/live-classes/native/:room/control"'));
 const join=source.slice(source.indexOf('router.post("/learning/live-classes/:id/join"'),
   source.indexOf('router.post("/learning/live-classes/:id/leave"'));
 assert.match(policy,/export function assertSchoolOSNativeLiveClassAdmissionAllowed/);
 assert.match(policy,/schoolOSVideoAdmissionEnabled\(organizationId\)/);
 assert.match(policy,/SCHOOLOS_VIDEO_NATIVE_CLASS_UNMETERED/);
 assert.match(session,/assertSchoolOSNativeLiveClassAdmissionAllowed\(req\.auth!\.organizationId\)/);
 assert.ok(session.indexOf("assertSchoolOSNativeLiveClassAdmissionAllowed")<session.indexOf("createLiveKitToken("));
 assert.match(join,/live\.provider === LiveClassProvider\.NATIVE/);
 assert.match(join,/assertSchoolOSNativeLiveClassAdmissionAllowed\(req\.auth!\.organizationId\)/);
 assert.ok(join.indexOf("assertSchoolOSNativeLiveClassAdmissionAllowed")<join.indexOf("liveClassAttendance.upsert"));
 const recording=source.slice(source.indexOf('router.post("/learning/live-classes/native/:room/recording/start"'),
   source.indexOf('router.post("/learning/live-classes/native/:room/recording/stop"'));
 assert.ok(recording.indexOf("assertSchoolOSNativeLiveClassAdmissionAllowed")<
   recording.indexOf('livekitEgress("StartEgress"'),
   "Unmetered paid-provider recording creation must fail before remote Egress");
});


test("native LiveKit recording LMS downloads use recording R2, not ordinary application storage", async () => {
  const source = await readFile(route, "utf8");
  const start = source.indexOf('router.get("/learning/materials/:id/download"');
  const end = source.indexOf('router.post("/learning/materials/:id/bookmark"', start);
  assert.ok(start > 0 && end > start, "LMS download endpoint exists");
  const download = source.slice(start, end);
  assert.match(download, /learningResourceWhere\(actor\)/, "Preserve role-scoped material lookup");
  assert.match(download, /sourceLiveClassId/, "Distinguish native recording materials");
  assert.match(download, /organizationId: row\.organizationId/, "Source must share the exact tenant");
  assert.match(download, /provider: LiveClassProvider\.NATIVE/, "Source must be a native LiveKit class");
  assert.match(download, /recordingObjectKey: row\.storageKey/, "Source object key must match stored LMS material");
  assert.match(download, /isRecording\s*\?\s*await getLiveKitRecordingObject\(row\.storageKey\)\s*:\s*await getObject\(row\.storageKey\)/,
    "LiveKit recordings must use their dedicated R2 client while ordinary LMS files retain general storage");
  assert.match(download, /RECORDING_PROCESSING/, "Incomplete Egress uploads should not be represented as downloadable");
  assert.ok(download.indexOf("const isRecording") < download.indexOf("getLiveKitRecordingObject(row.storageKey)"),
    "Tenant/source association must be verified before R2 access");
  assert.ok(download.indexOf("const object") === -1 || download.includes("let object"),
    "Material stream must be chosen by recording-specific routing");
});

test("LMS recording download counters are not incremented for missing R2 objects", async () => {
  const source = await readFile(route, "utf8");
  const start = source.indexOf('router.get("/learning/materials/:id/download"');
  const end = source.indexOf('router.post("/learning/materials/:id/bookmark"', start);
  const download = source.slice(start, end);
  const storageBranch = download.slice(download.indexOf("if (row.storageKey)"), download.indexOf("if (row.externalUrl)"));
  assert.ok(storageBranch.indexOf("getLiveKitRecordingObject(row.storageKey)") <
    storageBranch.indexOf("downloadCount: { increment: 1 }"),
    "Count only successfully retrieved storage objects");
});

test("classroom direct recordings and LMS recordings share pending-object handling", async () => {
  const [source, helper] = await Promise.all([
    readFile(route, "utf8"),
    readFile(livekit, "utf8"),
  ]);
  assert.match(helper, /export function livekitRecordingObjectMissing\(error: unknown\)/);
  const materialStart = source.indexOf('router.get("/learning/materials/:id/download"');
  const materialEnd = source.indexOf('router.post("/learning/materials/:id/bookmark"', materialStart);
  const directStart = source.indexOf('router.get("/learning/live-classes/native/:room/recording"');
  const directEnd = source.indexOf('router.get("/learning/gamification/me"', directStart);
  assert.ok(materialStart >= 0 && materialEnd > materialStart);
  assert.ok(directStart >= 0 && directEnd > directStart);
  for (const segment of [source.slice(materialStart, materialEnd), source.slice(directStart, directEnd)]) {
    assert.match(segment, /livekitRecordingObjectMissing\(error\)/);
    assert.match(segment, /RECORDING_PROCESSING/);
    assert.match(segment, /throw error/);
  }
});
