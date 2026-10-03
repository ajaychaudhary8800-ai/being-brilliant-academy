import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("camera media handoff is token-authenticated before JWT and exposes only approved HTTPS/WSS URLs", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const media = routes.indexOf('router.get("/device-hub/camera-media/:sessionId"');
  const guard = routes.indexOf("router.use(requireAuth");
  assert.ok(media >= 0 && media < guard);
  assert.match(routes, /x-camera-session-token/);
  assert.match(routes, /protocols\.includes\(url\.protocol\)/);
  assert.match(routes, /\["https:"\]/);
  assert.match(routes, /\["https:", "wss:"\]/);
});

test("camera stream commands keep secret references inside Edge Agent payload rather than API response", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/device-hub/cameras/:cameraId/sessions"');
  const section = routes.slice(start, start + 9000);
  assert.match(section, /streamSecretRef: camera\.streamSecretRef/);
  assert.match(section, /recordingSecretRef: camera\.recordingSecretRef/);
  assert.match(section, /credential: \{ sessionToken: token, displayOnce: true \}/);
  assert.doesNotMatch(section, /streamSecretRef:\s*result/);
});

test("camera playback is retention-bounded and session duration is capped", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /CAMERA_PLAYBACK_OUTSIDE_RETENTION/);
  assert.match(routes, /One playback session cannot exceed four hours/);
  assert.match(routes, /expiresAt = new Date\(now\.getTime\(\) \+ 10 \* 60_000\)/);
});

test("camera access actions are audited for live playback bookmark export and download", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  for (const action of ["LIVE_SESSION","PLAYBACK_SESSION","BOOKMARK","EXPORT_REQUEST","EXPORT_APPROVE","EXPORT_DOWNLOAD"]) {
    assert.match(schema, new RegExp(action));
  }
  assert.match(schema, /model CameraAccessAudit \{/);
});

test("video export requires a different approver and a watermark", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /CAMERA_EXPORT_SELF_APPROVAL_FORBIDDEN/);
  assert.match(routes, /watermarkText/);
  assert.match(routes, /CAMERA_EXPORT_CLIP/);
  assert.match(routes, /EXPORT_APPROVE/);
});

test("camera export download is short-lived, HTTPS-only and audited", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.get("/device-hub/camera-exports/:exportId/download"');
  const section = routes.slice(start, start + 5000);
  assert.match(section, /CAMERA_EXPORT_EXPIRED/);
  assert.match(section, /safeMediaResult/);
  assert.match(section, /CameraAccessAction\.EXPORT_DOWNLOAD/);
  assert.match(section, /Cache-Control/);
});

test("bus cameras map to existing vehicles and expose active trip context", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /CAMERA_VEHICLE_INVALID/);
  assert.match(routes, /\/device-hub\/cameras\/:cameraId\/trip-context/);
  assert.match(routes, /transportTrip\.findFirst/);
});

test("camera tamper and video-loss events are raised to high severity and persisted on camera health", async () => {
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(processor, /TAMPER\|CAMERA_COVERED\|VIDEO_LOSS/);
  assert.match(processor, /CameraIncidentSeverity\.HIGH/);
  assert.match(processor, /lastTamperAt: event\.occurredAt/);
});
