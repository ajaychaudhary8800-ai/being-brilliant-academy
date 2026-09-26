import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const webRoot = new URL("../../../web/", import.meta.url);

test("production compose passes native classroom configuration to API containers", async () => {
  const compose = await readFile(new URL("docker-compose.yml", root), "utf8");
  for (const key of [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "LIVEKIT_RECORDING_PREFIX",
    "LIVEKIT_RECORDING_S3_REGION",
    "LIVEKIT_RECORDING_S3_BUCKET",
    "LIVEKIT_RECORDING_S3_ENDPOINT",
    "LIVEKIT_RECORDING_S3_ACCESS_KEY_ID",
    "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY",
  ]) assert.match(compose, new RegExp(key));
});

test("environment examples document native classroom credentials", async () => {
  const [development, production] = await Promise.all([
    readFile(new URL(".env.example", root), "utf8"),
    readFile(new URL(".env.production.example", root), "utf8"),
  ]);
  for (const source of [development, production]) {
    assert.match(source, /LIVEKIT_URL=/);
    assert.match(source, /LIVEKIT_API_KEY=/);
    assert.match(source, /LIVEKIT_API_SECRET=/);
    assert.match(source, /LIVEKIT_RECORDING_S3_BUCKET=/);
    assert.match(source, /LIVEKIT_RECORDING_S3_ACCESS_KEY_ID=/);
    assert.match(source, /LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY=/);
  }
});

test("integration health and SaaS control center expose native classroom readiness", async () => {
  const [server, livekit, control] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/livekit.ts", import.meta.url), "utf8"),
    readFile(new URL("app/admin/control-center/page.tsx", webRoot), "utf8"),
  ]);
  assert.match(server, /livekitHealth/);
  assert.match(server, /livekit,/);
  assert.match(livekit, /roomList: true/);
  assert.match(livekit, /recordingConfigured/);
  assert.match(control, /Native live classroom/);
  assert.match(control, /recording storage ready/);
});


test("native classroom recording storage is isolated from general application storage", async () => {
  const [config, livekit, route] = await Promise.all([
    readFile(new URL("../config.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/livekit.ts", import.meta.url), "utf8"),
    readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8"),
  ]);
  assert.match(config, /LIVEKIT_RECORDING_S3_BUCKET/);
  assert.match(livekit, /getLiveKitRecordingObject/);
  assert.match(livekit, /LIVEKIT_RECORDING_S3_ACCESS_KEY_ID/);
  assert.match(route, /livekitRecordingStorage\(\)/);
  assert.match(route, /getLiveKitRecordingObject\(live\.recordingObjectKey\)/);
  const recordingStart = route.slice(route.indexOf('recording/start'), route.indexOf('recording/stop'));
  assert.doesNotMatch(recordingStart, /env\.AWS_S3_BUCKET/);
  assert.doesNotMatch(recordingStart, /env\.AWS_ACCESS_KEY_ID/);
});
