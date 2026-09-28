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

test("meeting API enforces tenant, branch and commercial boundaries", () => {
  assert.match(route, /organizationId: org\(req\)/);
  assert.match(route, /requireCommercialFeature\("meetings"\)/);
  assert.match(route, /erpBranchScope\(req\)/);
  assert.match(route, /assertErpBranchAccess/);
  assert.match(route, /MEETING_PARTICIPANT_BRANCH_FORBIDDEN/);
  assert.match(server, /onlyPaths\(\["\/meetings"\], meetings\)/);
});

test("meeting room identity is opaque and server generated", () => {
  assert.match(route, /crypto\.randomUUID\(\)/);
  assert.match(route, /livekitRoomName: roomName/);
  assert.doesNotMatch(route, /req\.body\.livekitRoomName/);
});

test("host and co-host management are explicit meeting roles", () => {
  assert.match(schema, /enum MeetingParticipantRole \{[\s\S]*?HOST[\s\S]*?CO_HOST/);
  assert.match(route, /MeetingParticipantRole\.HOST/);
  assert.match(route, /MeetingParticipantRole\.CO_HOST/);
});
