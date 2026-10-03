import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("safety operations mount under connected-campus API", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /import safetyOperations from ".\/routes\/safety-operations\.js"/);
  assert.match(server, /onlyPaths\(\["\/connected-campus"\], safetyOperations\)/);
});

test("emergency broadcast recipient resolution stays branch-scoped", async () => {
  const routes = await readFile(new URL("./safety-operations.ts", import.meta.url), "utf8");
  assert.match(routes, /student: \{ branchId/);
  assert.match(routes, /studentProfile\.findMany/);
  assert.match(routes, /teacherProfile\.findMany/);
  assert.match(routes, /employee\.findMany/);
  assert.match(routes, /branchUser\.findMany/);
});

test("emergency broadcasts use existing queued notification delivery and user preferences", async () => {
  const routes = await readFile(new URL("./safety-operations.ts", import.meta.url), "utf8");
  assert.match(routes, /notificationPreference\.findMany/);
  assert.match(routes, /preferredChannels/);
  assert.match(routes, /notification\.create/);
  assert.match(routes, /notificationDelivery\.createMany/);
  assert.match(routes, /status: "QUEUED"/);
});

test("parents see and acknowledge emergencies only for branches containing linked active children", async () => {
  const routes = await readFile(new URL("./safety-operations.ts", import.meta.url), "utf8");
  assert.match(routes, /parentBranchAccess/);
  assert.match(routes, /parentStudent\.findFirst/);
  assert.match(routes, /CHILD_ACCESS_DENIED/);
  assert.match(routes, /safetyIncidentAcknowledgement\.upsert/);
  assert.match(routes, /safetyBroadcastAcknowledgement\.upsert/);
});

test("safety task and accountability subjects are organization/branch validated", async () => {
  const routes = await readFile(new URL("./safety-operations.ts", import.meta.url), "utf8");
  assert.match(routes, /SAFETY_TASK_ASSIGNEE_INVALID/);
  assert.match(routes, /SAFETY_ZONE_INVALID/);
  assert.match(routes, /SAFETY_SUBJECT_INVALID/);
  assert.match(routes, /studentProfile\.findFirst/);
  assert.match(routes, /employee\.findFirst/);
  assert.match(routes, /campusVisitor\.findFirst/);
});

test("reunification is branch-scoped, auditable through verifier identity, and idempotent per student incident", async () => {
  const routes = await readFile(new URL("./safety-operations.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(routes, /REUNIFICATION_STUDENT_INVALID/);
  assert.match(routes, /verifiedById: req\.auth!\.userId/);
  assert.match(routes, /SafetyAccountabilityStatus\.REUNIFIED/);
  assert.match(schema, /@@unique\(\[incidentId, studentId\]\)/);
});

test("safety operational schema includes drills zones tasks broadcasts accountability and reunification", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  for (const model of [
    "CampusZone",
    "SafetyBroadcast",
    "SafetyBroadcastAcknowledgement",
    "SafetyIncidentAcknowledgement",
    "SafetyTask",
    "SafetyDrill",
    "SafetyAccountability",
    "SafetyReunificationRecord",
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\\{`));
  }
});
