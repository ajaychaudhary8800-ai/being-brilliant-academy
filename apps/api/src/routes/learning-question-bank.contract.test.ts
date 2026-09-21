import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");

test("random Question Bank selection accepts and applies Course scope", () => {
  assert.match(route, /router\.post\("\/learning\/questions\/random"/);
  assert.match(route, /courseId: id\.optional\(\)/);
  assert.match(route, /\.\.\.\(d\.courseId \? \{ courseId: d\.courseId \} : \{\}\)/);
  assert.match(route, /approvalStatus: ApprovalStatus\.APPROVED/);
  assert.match(route, /isArchived: false/);
});

test("Question Bank editing preserves version history and resets approval", () => {
  assert.match(route, /questionBankRevision\.create/);
  assert.match(route, /version: \{ increment: 1 \}/);
  assert.match(route, /approvalStatus: ApprovalStatus\.DRAFT/);
  assert.match(route, /router\.post\("\/learning\/questions\/bulk"/);
  assert.match(route, /router\.get\("\/learning\/questions\/export"/);
});
