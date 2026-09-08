import assert from "node:assert/strict";
import test from "node:test";
import { communicationFields } from "./communication-display";

const settings = { timeZone: "Asia/Calcutta", locale: "en-IN" };

test("communication rows expose meaningful relation labels without raw identifiers", () => {
  const row = {
    id: "cm12345678901234567890123",
    organizationId: "org-secret",
    branchId: "branch-secret",
    batchId: "batch-secret",
    authorId: "user-secret",
    title: "Term update",
    audience: "STUDENT",
    branch: { branchName: "Central Campus" },
    batch: { name: "Class 10 A" },
    author: { name: "Anita Sharma" },
    publishedAt: "2026-09-08T04:30:00.000Z",
  };
  const fields = communicationFields("announcements", row, settings);
  const output = JSON.stringify(fields);
  assert.match(output, /Central Campus/);
  assert.match(output, /Class 10 A/);
  assert.match(output, /Anita Sharma/);
  assert.match(output, /10:00/);
  for (const hidden of [row.id, row.organizationId, row.branchId, row.batchId, row.authorId]) assert.doesNotMatch(output, new RegExp(hidden));
});

test("message rows show participant names and roles instead of user IDs", () => {
  const fields = communicationFields("messages", {
    senderId: "sender-secret",
    recipientId: "recipient-secret",
    subject: "Progress update",
    sender: { name: "Meera", role: "PARENT" },
    recipient: { name: "Vikram", role: "TEACHER" },
    createdAt: "2026-09-08T04:30:00.000Z",
  }, settings);
  const output = JSON.stringify(fields);
  assert.match(output, /Meera · PARENT/);
  assert.match(output, /Vikram · TEACHER/);
  assert.doesNotMatch(output, /sender-secret|recipient-secret/);
});

test("circulars and events use authorized relation names for targets", () => {
  const circular = communicationFields("circulars", { number: "CIR-10", title: "Holiday", branchId: "hidden", branch: { branchName: "North" }, publishedAt: "2026-09-08T04:30:00.000Z" }, settings);
  const event = communicationFields("events", { title: "PTM", type: "PTM", status: "SCHEDULED", branchId: "hidden", batchId: "hidden", branch: { branchName: "North" }, batch: { name: "Grade 8" }, startsAt: "2026-09-08T04:30:00.000Z", endsAt: "2026-09-08T05:30:00.000Z" }, settings);
  assert.match(JSON.stringify(circular), /North/);
  assert.match(JSON.stringify(event), /North.*Grade 8/);
  assert.doesNotMatch(JSON.stringify([circular, event]), /hidden/);
});
