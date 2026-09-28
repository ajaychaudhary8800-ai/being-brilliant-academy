import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../../prisma/schema.prisma", import.meta.url);
const routeUrl = new URL("./meetings.ts", import.meta.url);
const serverUrl = new URL("../server.ts", import.meta.url);
const migrationUrl = new URL("../../prisma/migrations/20260928164500_add_enterprise_meetings/migration.sql", import.meta.url);

test("staff meetings are a separate enterprise domain from LiveClass", async () => {
  const schema = await readFile(schemaUrl, "utf8");
  for (const model of [
    "MeetingSeries", "Meeting", "MeetingAudience", "MeetingParticipant", "MeetingAgendaItem",
    "MeetingAttachment", "MeetingAttendance", "MeetingAttendanceSession", "MeetingMinutes",
    "MeetingDecision", "MeetingActionItem", "MeetingRecording", "MeetingInvite",
    "MeetingCalendarLink", "MeetingAuditLog",
  ]) assert.match(schema, new RegExp(`model ${model} \\\{`));
  const meeting = schema.slice(schema.indexOf("model Meeting {"), schema.indexOf("model MeetingAudience {"));
  assert.doesNotMatch(meeting, /LiveClass/);
  assert.match(meeting, /organizationId\s+String/);
  assert.match(meeting, /branchId\s+String\?/);
  assert.match(meeting, /departmentId\s+String\?/);
  assert.match(meeting, /livekitRoomName\s+String\?/);
});

test("meeting API derives room authority server-side and preserves scope", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /requireCommercialFeature\("meetings"\)/);
  assert.match(route, /assertFeatureEntitled\(scope\.organizationId, "meetings_recording"\)/);
  assert.match(route, /participants: \{ some: \{ userId: scope\.userId, removedAt: null \} \}/);
  assert.match(route, /visibility: MeetingVisibility\.BRANCH, branchId: \{ in: scope\.branchIds \}/);
  assert.match(route, /visibility: MeetingVisibility\.DEPARTMENT, departmentId: \{ in: scope\.departmentIds \}/);
  assert.match(route, /meetingManagerRoles\.has\(participant\.meetingRole\)/);
  assert.match(route, /createLiveKitToken\(\{/);
  assert.match(route, /role: participant\.meetingRole/);
  assert.doesNotMatch(route, /req\.body\.role.*createLiveKitToken/s);
});

test("meeting search composes visibility and text filters instead of replacing authorization OR", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /AND:\s*\[\s*visibleMeetingWhere\(scope\)/);
  assert.match(route, /q\.search \? \[\{ OR:/);
});

test("meeting lifecycle covers collaboration, governance and accountability", async () => {
  const route = await readFile(routeUrl, "utf8");
  for (const path of [
    "/meetings/:id/join-token",
    "/meetings/:id/control",
    "/meetings/:id/whiteboard",
    "/meetings/:id/attendance/join",
    "/meetings/:id/attendance/leave",
    "/meetings/:id/minutes",
    "/meetings/:id/decisions",
    "/meetings/:id/actions",
    "/meetings/:id/recordings/start",
    "/meetings/:id/recordings/stop",
    "/meetings/:id/audit",
  ]) assert.ok(route.includes(path), `missing route ${path}`);
  assert.match(route, /MeetingParticipantRole\.HOST/);
  assert.match(route, /MeetingParticipantRole\.CO_HOST/);
  assert.match(route, /MeetingAttendanceStatus\.PRESENT/);
  assert.match(route, /MeetingMinutesStatus\.APPROVED/);
  assert.match(route, /MeetingActionStatus\.COMPLETED/);
});

test("server mounts meetings independently and migration enables commercial feature keys", async () => {
  const [server, migration] = await Promise.all([readFile(serverUrl, "utf8"), readFile(migrationUrl, "utf8")]);
  assert.match(server, /import meetings from "\.\/routes\/meetings\.js"/);
  assert.match(server, /onlyPaths\(\["\/meetings", "\/meeting-actions"\], meetings\)/);
  assert.match(migration, /"meetings": true/);
  assert.match(migration, /"meetings_recording": true/);
});
