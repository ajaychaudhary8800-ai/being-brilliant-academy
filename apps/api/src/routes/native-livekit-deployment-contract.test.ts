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


test("V5 isolated staging confines LiveKit and recording secrets to the API container", async () => {
  const compose = await readFile(new URL("docker-compose.schoolos-v5-staging.yml", root), "utf8");
  const sharedStart = compose.indexOf("x-api-env: &api-env");
  const servicesStart = compose.indexOf("\nservices:");
  const migrateStart = compose.indexOf("\n  migrate:");
  const apiStart = compose.indexOf("\n  api:");
  const webStart = compose.indexOf("\n  web:");
  assert.ok(sharedStart >= 0 && servicesStart > sharedStart
    && migrateStart > servicesStart && apiStart > migrateStart && webStart > apiStart,
    "Expected separate shared env, migration, API and Web service blocks");

  const shared = compose.slice(sharedStart, servicesStart);
  const migration = compose.slice(migrateStart, apiStart);
  const api = compose.slice(apiStart, webStart);
  const web = compose.slice(webStart);

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
  ]) {
    assert.doesNotMatch(shared, new RegExp("^\\s*" + key + ":", "m"), key + " must not leak via the shared migrate/API anchor");
    assert.doesNotMatch(migration, new RegExp("^\\s*" + key + ":", "m"), key + " must not be set on the migration service");
    assert.doesNotMatch(api, new RegExp("^\\s*" + key + ":", "m"), key + " must come from the API-only protected file");
    assert.doesNotMatch(web, new RegExp("^\\s*" + key + ":", "m"), key + " must not be set on the Web service");
  }
  assert.match(api, /SCHOOLOS_V5_LIVEKIT_ENV_FILE: \/run\/secrets\/schoolos-v5-livekit-api\.env/);
  assert.match(api, /\/etc\/schoolos\/v5-staging\/livekit-v5-api\.env:\/run\/secrets\/schoolos-v5-livekit-api\.env:ro/);
  const entrypoint = await readFile(new URL("apps/api/docker-entrypoint.sh", root), "utf8");
  assert.match(entrypoint, /SCHOOLOS_V5_LIVEKIT_ENV_FILE/);
  assert.doesNotMatch(entrypoint, /(?:^|\n)\s*\.\s+"?\$media_file/m);
  assert.doesNotMatch(entrypoint, /eval\s+.*\$media_file/);
});
