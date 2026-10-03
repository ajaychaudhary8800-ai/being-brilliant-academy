import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("campus camera configuration stores only secret references and masks them on list responses", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /streamSecretRef/);
  assert.match(routes, /recordingSecretRef/);
  assert.match(routes, /Store a secret reference identifier rather than a raw endpoint URL/);
  assert.match(routes, /streamSecretRef: camera\.streamSecretRef \? "\[configured\]" : null/);
  assert.match(routes, /recordingSecretRef: camera\.recordingSecretRef \? "\[configured\]" : null/);
});

test("campus camera requires a Device Hub CAMERA record in the same branch", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /ConnectedDeviceKind\.CAMERA/);
  assert.match(routes, /CAMERA_DEVICE_KIND_INVALID/);
  assert.match(routes, /CAMERA_DEVICE_BRANCH_MISMATCH/);
});

test("automated camera events always create review-required incidents", async () => {
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  const start = processor.indexOf("async function processVideo");
  assert.ok(start >= 0);
  const section = processor.slice(start, start + 6500);
  assert.match(section, /reviewRequired: true/);
  assert.match(section, /cameraIncident\.upsert/);
  assert.match(section, /where: \{ deviceEventId: event\.id \}/);
  assert.match(section, /CAMERA_INCIDENT/);
});

test("camera AI review flag does not convert incidents into automatic decisions", async () => {
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  const start = processor.indexOf("async function processVideo");
  const end = processor.indexOf("export async function processConnectedDeviceEvent", start);
  const section = processor.slice(start, end);
  assert.match(section, /aiReviewEnabled/);
  assert.match(section, /reviewRequired: true/);
  assert.doesNotMatch(section, /reviewRequired: false/);
  assert.doesNotMatch(section, /disciplin/i);
});

test("camera incidents constrain severity and confidence inputs", async () => {
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(processor, /Object\.values\(CameraIncidentSeverity\)/);
  assert.match(processor, /confidenceRaw >= 0 && confidenceRaw <= 1/);
});

test("camera incident resolution requires human review notes and audit", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.patch("/device-hub/camera-incidents/:incidentId"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 4500);
  assert.match(section, /CAMERA_INCIDENT_RESOLUTION_REQUIRED/);
  assert.match(section, /resolvedById: req\.auth!\.userId/);
  assert.match(section, /CAMERA_INCIDENT_REVIEWED/);
});

test("camera schema defaults to privacy masking and review-required incidents", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /privacyMasking\s+Boolean\s+@default\(true\)/);
  assert.match(schema, /reviewRequired\s+Boolean\s+@default\(true\)/);
  assert.match(schema, /deviceEventId\s+String\?\s+@unique/);
});
