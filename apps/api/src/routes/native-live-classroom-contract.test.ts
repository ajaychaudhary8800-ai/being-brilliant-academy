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
  assert.match(source, /getObject\(live\.recordingObjectKey\)/);
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
