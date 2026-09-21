import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./learning-ecosystem-workspace.tsx", import.meta.url), "utf8");

test("students can open, bookmark and escalate Doubt threads", () => {
  assert.match(source, /setActiveDoubt\(x\);setDoubtReply\(""\)/);
  assert.match(source, /\/learning\/doubts\/"\+x\.id\+"\/bookmark"/);
  assert.match(source, /bookmarked:!x\.bookmarked/);
  assert.match(source, /\/learning\/doubts\/"\+x\.id\+"\/escalate"/);
  assert.match(source, /Doubt escalated to teacher/);
});

test("students and teachers can send thread messages with role-appropriate behavior", () => {
  assert.match(source, /\/learning\/doubts\/"\+activeDoubt\.id\+"\/messages"/);
  assert.match(source, /user!\.role==="TEACHER"\?"Teacher response sent and doubt resolved":"Follow-up sent"/);
  assert.match(source, /\["STUDENT","TEACHER"\]\.includes\(user!\.role\)/);
  assert.match(source, /Teacher response \(sending resolves the doubt\)/);
  assert.match(source, /Ask a follow-up/);
});

test("non-teacher managers get thread visibility without reply permission", () => {
  assert.match(source, /tab==="doubts"&&<button[^>]*>Open thread<\/button>/);
  assert.match(source, /\["STUDENT","TEACHER"\]\.includes\(user!\.role\)&&<div/);
});
