import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("school event graph is idempotent per tenant and source record", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /model SchoolEvent \{/);
  assert.match(schema, /@@unique\(\[organizationId, sourceType, sourceId\]\)/);
});

test("Device Hub adapters emit canonical school events for attendance, transport, access and camera", async () => {
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(processor, /SchoolEventCategory\.ATTENDANCE/);
  assert.match(processor, /SchoolEventCategory\.TRANSPORT/);
  assert.match(processor, /SchoolEventCategory\.ACCESS/);
  assert.match(processor, /SchoolEventCategory\.CAMERA/);
  assert.match(processor, /recordSchoolEvent/);
});

test("camera and uncertain access events preserve human-review status in event graph", async () => {
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(processor, /reviewRequired: created\.decision === CampusAccessDecision\.REVIEW/);
  assert.match(processor, /reviewRequired: true,[\s\S]*CAMERA_INCIDENT/);
});

test("school event timeline is tenant and branch scoped", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.get("/device-hub/events"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 6500);
  assert.match(section, /organizationId: req\.auth!\.organizationId/);
  assert.match(section, /branchId: \{ in: scope \}/);
  assert.match(section, /assertErpBranchTarget\(scope, q\.branchId\)/);
});

test("event context correlation is bounded to a thirty-minute window", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.get("/device-hub/events/:eventId/context"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 4500);
  assert.match(section, /15 \* 60_000/);
  assert.match(section, /take: 200/);
  assert.match(section, /correlationKey/);
});

test("event resolution requires human notes and is audit logged", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.patch("/device-hub/events/:eventId/review"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 4500);
  assert.match(section, /SCHOOL_EVENT_RESOLUTION_REQUIRED/);
  assert.match(section, /resolvedById: req\.auth!\.userId/);
  assert.match(section, /SCHOOL_EVENT_REVIEWED/);
});
