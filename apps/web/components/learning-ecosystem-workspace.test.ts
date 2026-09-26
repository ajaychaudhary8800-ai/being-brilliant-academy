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


test("Learning Ecosystem managers can build Tests from approved Question Bank items", () => {
  assert.match(source, /\["questions","tests","materials","live-classes"\]/);
  assert.match(source, /function LearningTestBuilder/);
  assert.match(source, /approvalStatus:"APPROVED"/);
  assert.match(source, /Create draft Test/);
  assert.match(source, /questions:chosen\.map/);
  assert.match(source, /maximumMarks/);
  assert.match(source, /status:"DRAFT"/);
});

test("Learning Test manager lifecycle exposes publish, archive and safe delete controls", () => {
  assert.match(source, /"Test published"/);
  assert.match(source, /"Test archived"/);
  assert.match(source, /Delete this archived test\?/);
  assert.match(source, /method:"DELETE"/);
  assert.match(source, /\["PRACTICE","CHAPTER","UNIT","FULL","MOCK","ADAPTIVE"\]/);
});


test("Question Bank manager exposes edit, review, archive, import and export workflows", () => {
  assert.match(source, /setEditingQuestion\(x\);setForm\("questions"\)/);
  assert.match(source, /approvalStatus":"APPROVED"/);
  assert.match(source, /approvalStatus":"REJECTED"/);
  assert.match(source, /approvalStatus":"ARCHIVED"/);
  assert.match(source, /\/learning\/questions\/export/);
  assert.match(source, /\/learning\/questions\/bulk/);
  assert.match(source, /Question updated; approval reset to draft/);
});

test("Question editor exposes assessment metadata and the builder supports random approved selection", () => {
  assert.match(source, /\["MCQ","MSQ","NUMERICAL","ASSERTION_REASON","PARAGRAPH","MATCHING","SUBJECTIVE"\]/);
  assert.match(source, /\["EASY","MEDIUM","HARD"\]/);
  assert.match(source, /Negative marks/);
  assert.match(source, /Solution \/ explanation/);
  assert.match(source, /\/learning\/questions\/random/);
  assert.match(source, /Random 10/);
  assert.match(source, /courseId:v\.courseId/);
});


test("manager AI learning plan requires an explicit student target and reloads scoped dashboard data", () => {
  assert.match(source, /planStudentId/);
  assert.match(source, /Select student/);
  assert.match(source, /userId:planStudentId/);
  assert.match(source, /dashboard\$\{manager&&planStudentId/);
  assert.match(source, /Generate student plan/);
});


test("Live Class selectors expose loading errors, retry and dependent filtering", () => {
  assert.match(source, /optionsLoading/);
  assert.match(source, /optionsError/);
  assert.match(source, /Reload options/);
  assert.match(source, /No active branches/);
  assert.match(source, /Select branch first/);
  assert.match(source, /No active batches for this course/);
  assert.match(source, /No confirmed subjects for this course/);
  assert.match(source, /No active teacher allocation matches this class/);
  assert.match(source, /x\.branchId===v\.branchId/);
  assert.match(source, /x\.courseIds\.includes\(v\.courseId\)/);
  assert.match(source, /a\.subjectId===v\.subjectId/);
});
