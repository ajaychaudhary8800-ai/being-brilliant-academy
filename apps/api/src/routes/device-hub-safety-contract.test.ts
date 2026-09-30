import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("device safety signals create critical reviewable incidents", async () => {
  const source = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /function isSafetySignal/);
  assert.match(source, /SOS\|PANIC\|FIRE\|EMERGENCY\|DISTRESS/);
  assert.match(source, /safetyIncident\.upsert/);
  assert.match(source, /reviewRequired: true/);
  assert.match(source, /SchoolEventCategory\.SAFETY/);
});

test("device safety incidents require branch assignment", async () => {
  const source = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(source, /SAFETY_SIGNAL_BRANCH_REQUIRED/);
});

test("command-center management remains behind authenticated admin middleware", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const guard = routes.indexOf("router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN))");
  const safety = routes.indexOf('router.get("/device-hub/safety-incidents"');
  assert.ok(guard >= 0);
  assert.ok(safety > guard);
});

test("emergency operating modes are human-controlled and audit logged", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/device-hub/safety-incidents/:incidentId/mode"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 5500);
  assert.match(section, /emergencyMode: z\.enum\(\["ALERT","SECURE_CAMPUS","EVACUATION","REUNIFICATION","ALL_CLEAR"\]\)/);
  assert.match(section, /SAFETY_EMERGENCY_MODE_CHANGED/);
  assert.match(section, /commanderId: req\.auth!\.userId/);
});

test("closed safety incidents cannot receive new mode changes", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /SAFETY_INCIDENT_CLOSED/);
  assert.match(routes, /SafetyIncidentStatus\.RESOLVED/);
  assert.match(routes, /SafetyIncidentStatus\.FALSE_ALARM/);
});

test("resolution synchronizes the linked school event and records notes", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/device-hub/safety-incidents/:incidentId/resolve"');
  const section = routes.slice(start, start + 6000);
  assert.match(section, /resolutionNotes: z\.string\(\)\.trim\(\)\.min\(5\)/);
  assert.match(section, /EmergencyMode\.ALL_CLEAR/);
  assert.match(section, /schoolEvent\.updateMany/);
  assert.match(section, /SAFETY_INCIDENT_RESOLVED/);
});

test("safety schema records incident timeline updates", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /model SafetyIncident \{/);
  assert.match(schema, /model SafetyIncidentUpdate \{/);
  assert.match(schema, /updates\s+SafetyIncidentUpdate\[\]/);
  assert.match(schema, /deviceEventId\s+String\?\s+@unique/);
});
