import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
const route = await readFile(new URL("./meetings.ts", import.meta.url), "utf8");
const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");

test("enterprise meetings are a separate domain from LiveClass", () => {
  assert.match(schema, /model Meeting \{/);
  assert.match(schema, /model MeetingParticipant \{/);
  assert.match(schema, /model MeetingMinutes \{/);
  assert.match(schema, /model MeetingActionItem \{/);
  assert.match(schema, /model MeetingRecording \{/);
  const block = schema.match(/model Meeting \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(block, /LiveClass/);
  assert.doesNotMatch(route, /liveClass/i);
});

test("meeting inputs support existing opaque database identifiers", async () => {
  const workflow = await readFile(new URL("./meeting-workflow.ts", import.meta.url), "utf8");
  assert.match(route, /const id = z\.string\(\)\.trim\(\)\.min\(1\)\.max\(191\)/);
  assert.match(workflow, /const id = z\.string\(\)\.trim\(\)\.min\(1\)\.max\(191\)/);
  assert.doesNotMatch(route, /const id = z\.string\(\)\.cuid\(\)/);
  assert.doesNotMatch(workflow, /const id = z\.string\(\)\.cuid\(\)/);
});

test("meeting API enforces tenant, branch and commercial boundaries", () => {
  assert.match(route, /organizationId: org\(req\)/);
  assert.match(route, /requireCommercialFeature\("meetings"\)/);
  assert.match(route, /erpBranchScope\(req\)/);
  assert.match(route, /assertErpBranchAccess/);
  assert.match(route, /MEETING_PARTICIPANT_BRANCH_FORBIDDEN/);
  assert.match(route, /mutableMeetingStatuses = new Set<MeetingStatus>\(\[MeetingStatus\.DRAFT, MeetingStatus\.SCHEDULED, MeetingStatus\.OPEN_FOR_JOIN, MeetingStatus\.LIVE\]\)/);
  assert.match(route, /respondableMeetingStatuses = new Set<MeetingStatus>\(\[MeetingStatus\.SCHEDULED, MeetingStatus\.OPEN_FOR_JOIN, MeetingStatus\.LIVE\]\)/);
  assert.match(route, /MEETING_RESPONSE_CLOSED/);
  assert.match(server, /onlyPaths\(\["\/meetings", "\/meeting-series", "\/meeting-teams"\], meetings\)/);
});

test("meeting room identity is opaque and server generated", () => {
  assert.match(route, /crypto\.randomUUID\(\)/);
  assert.match(route, /livekitRoomName:\s*`mtg_\$\{crypto\.randomUUID\(\)\.replaceAll\("-", ""\)\}`/);
  assert.doesNotMatch(route, /req\.body\.livekitRoomName/);
});

test("host and co-host management are explicit meeting roles", () => {
  assert.match(schema, /enum MeetingParticipantRole \{[\s\S]*?HOST[\s\S]*?CO_HOST/);
  assert.match(route, /MeetingParticipantRole\.HOST/);
  assert.match(route, /MeetingParticipantRole\.CO_HOST/);
});


test("recurring meetings keep a durable series template and occurrence identity", () => {
  assert.match(schema, /model MeetingSeries \{[\s\S]*?template\s+Json/);
  assert.match(schema, /occurrenceIndex\s+Int\?/);
  assert.match(schema, /@@unique\(\[seriesId, occurrenceIndex\]\)/);
  assert.match(route, /router\.post\("\/meeting-series"/);
  assert.match(route, /generateMeetingOccurrences/);
});

test("department and reusable team audiences are first-class meeting concepts", () => {
  assert.match(schema, /model MeetingTeam \{/);
  assert.match(schema, /model MeetingTeamMember \{/);
  assert.match(route, /router\.post\("\/meeting-teams"/);
  assert.match(route, /audiences: z\.array\(audienceInput\)/);
  assert.match(route, /resolveMeetingParticipants/);
});

test("meeting invitations use the existing notification infrastructure", async () => {
  const scheduling = await readFile(new URL("../lib/meeting-scheduling.ts", import.meta.url), "utf8");
  assert.match(schema, /model MeetingInvite \{/);
  assert.match(scheduling, /prisma\.notification\.create/);
  assert.match(scheduling, /prisma\.notificationDelivery\.createMany/);
  assert.match(scheduling, /REMINDER_1440/);
  assert.match(scheduling, /REMINDER_60/);
  assert.match(scheduling, /REMINDER_10/);
  assert.match(server, /meetingReminders/);
});


test("native meeting collaboration reuses LiveKit without using LiveClass records", async () => {
  const live = await readFile(new URL("./meeting-live.ts", import.meta.url), "utf8");
  assert.match(live, /createLiveKitToken/);
  assert.match(live, /livekitRoomService/);
  assert.match(live, /livekitEgress/);
  assert.match(live, /meetingAttendanceSession/);
  assert.match(live, /\[MeetingStatus\.SCHEDULED, MeetingStatus\.OPEN_FOR_JOIN, MeetingStatus\.LIVE\]\.includes\(meeting\.status\)/);
  assert.match(live, /meetingRecording/);
  assert.match(live, /meetingInteraction/);
  assert.match(live, /whiteboardData/);
  assert.doesNotMatch(live, /prisma\.liveClass/);
  assert.match(server, /onlyPaths\(\["\/meetings\/native"\], meetingLive\)/);
});

test("meeting workflow covers attendance minutes decisions and action tracking", async () => {
  const workflow = await readFile(new URL("./meeting-workflow.ts", import.meta.url), "utf8");
  assert.match(workflow, /\/meetings\/:id\/attendance/);
  assert.match(workflow, /\/meetings\/:id\/minutes\/approve/);
  assert.match(workflow, /\/meetings\/:id\/minutes\/publish/);
  assert.match(workflow, /\/meetings\/:id\/close/);
  assert.match(workflow, /MeetingStatus\.MINUTES_PUBLISHED/);
  assert.match(workflow, /MeetingStatus\.CLOSED/);
  assert.match(workflow, /\/meetings\/:id\/decisions/);
  assert.match(workflow, /\/meetings\/:id\/actions/);
  assert.match(workflow, /\/meeting-actions\/:id\/complete/);
  assert.match(workflow, /overdue/);
});

test("meeting occurrences synchronize with internal ERP calendar", () => {
  assert.match(schema, /calendarEventId\s+String\?\s+@unique/);
  assert.match(route, /calendarEvent\.create/);
  assert.match(route, /calendarEventRsvp\.createMany/);
  assert.match(route, /calendarEventRsvp\.upsert/);
});


test("meeting participant UI exposes staff workflows safely", async () => {
  const detail = await readFile(new URL("../../../web/app/meetings/[id]/page.tsx", import.meta.url), "utf8");
  const list = await readFile(new URL("../../../web/app/meetings/page.tsx", import.meta.url), "utf8");
  const portal = await readFile(new URL("../../../web/components/portal-workspace.tsx", import.meta.url), "utf8");
  assert.match(detail, /activeMeeting=Boolean\(meeting&&\["SCHEDULED","OPEN_FOR_JOIN","LIVE"\]\.includes\(meeting\.status\)\)/);
  assert.match(detail, /canRespond=Boolean\(self&&activeMeeting\)/);
  assert.match(list, /\["OPEN_FOR_JOIN","LIVE"\]\.includes\(m\.status\)/);
  assert.match(portal, /"live-classes", "meetings", "students"/);
  assert.match(portal, /href="\/meetings"[^]*Meetings/);
  assert.match(portal, /item\.actionUrl[^]*href=\{item\.actionUrl\}[^]*Open/);
});
