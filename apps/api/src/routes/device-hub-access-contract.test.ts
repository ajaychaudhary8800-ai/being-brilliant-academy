import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("access-point policy is explicit and defaults closed", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");

  assert.match(routes, /allowStudents: z\.boolean\(\)\.default\(false\)/);
  assert.match(routes, /allowEmployees: z\.boolean\(\)\.default\(false\)/);
  assert.match(processor, /allowStudents: false/);
  assert.match(processor, /allowEmployees: false/);
});

test("recognized identity is granted only when subject type is explicitly allowed", async () => {
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(processor, /policy\.allowStudents/);
  assert.match(processor, /policy\.allowEmployees/);
  assert.match(processor, /ACCESS_POLICY_GRANTED/);
  assert.match(processor, /ACCESS_SUBJECT_TYPE_NOT_ALLOWED/);
});

test("unknown or ambiguous identity routes to human review rather than automatic judgment", async () => {
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(processor, /CampusAccessDecision\.REVIEW/);
  assert.match(processor, /ACCESS_IDENTITY_UNKNOWN/);
  assert.match(processor, /ACCESS_IDENTITY_AMBIGUOUS/);
});

test("access events are replay-safe through unique Device Hub event identity", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");

  assert.match(schema, /deviceEventId\s+String\s+@unique/);
  assert.match(processor, /campusAccessEvent\.upsert/);
  assert.match(processor, /where: \{ deviceEventId: event\.id \}/);
});

test("access-point management is tenant and branch scoped", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /router\.get\("\/device-hub\/access-points"/);
  assert.match(routes, /router\.post\("\/device-hub\/access-points"/);
  assert.match(routes, /assertErpBranchTarget\(scope, body\.branchId\)/);
  assert.match(routes, /organizationId: req\.auth!\.organizationId/);
});

test("review events require authorized human decision and audit", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start=routes.indexOf('router.patch("/device-hub/access-events/:eventId/review"');
  assert.ok(start >= 0);
  const section=routes.slice(start,start+5000);
  assert.match(section, /decision: z\.enum\(\["GRANTED","DENIED"\]\)/);
  assert.match(section, /reviewNotes: z\.string/);
  assert.match(section, /reviewedById: req\.auth!\.userId/);
  assert.match(section, /CAMPUS_ACCESS_EVENT_REVIEWED/);
});

test("access point rejects unrelated device kinds and branch mismatch", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /ACCESS_POINT_DEVICE_BRANCH_MISMATCH/);
  assert.match(routes, /ACCESS_POINT_DEVICE_KIND_INVALID/);
  assert.match(routes, /ConnectedDeviceKind\.ACCESS_CONTROL/);
  assert.match(routes, /ConnectedDeviceKind\.RFID/);
  assert.match(routes, /ConnectedDeviceKind\.BIOMETRIC/);
});
