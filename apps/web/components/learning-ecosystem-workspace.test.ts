import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./learning-ecosystem-workspace.tsx", import.meta.url), "utf8");

test("Learning Ecosystem manager UI uses the scoped options contract", () => {
  assert.match(source, /call\("\/learning\/options"\)/);
  assert.match(source, /Course.*options\.courses/);
  assert.match(source, /Branch.*options\.branches/);
  assert.match(source, /Batch.*options\.batches/);
  assert.match(source, /Teacher.*options\.teachers/);
});

test("Learning material downloads use bearer-authenticated blob handling", () => {
  assert.match(source, /openAuthenticatedDocument/);
  assert.match(source, /getAccessToken\(\)\?\?""/);
  assert.match(source, /downloadMaterial\(x\)/);
  assert.doesNotMatch(source, /href=\{`\$\{API\}\/learning\/materials\/\$\{x\.id\}\/download`\}/);
});

test("Question creation includes Course scope and role-safe navigation remains explicit", () => {
  assert.match(source, /courseId:""/);
  assert.match(source, /label="Course" value=\{v\.courseId\}/);
  assert.match(source, /\["SUPER_ADMIN","BRANCH_ADMIN","TEACHER"\]/);
  assert.doesNotMatch(source, /ACCOUNTANT.*manager/);
  assert.doesNotMatch(source, /EMPLOYEE.*manager/);
});
