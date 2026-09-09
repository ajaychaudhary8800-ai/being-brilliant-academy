import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lessonOrderFromInput, teacherLessonRequestPayload } from "./portal-lms-workspace";

const workspace = readFileSync(new URL("./portal-lms-workspace.tsx", import.meta.url), "utf8");
const portal = readFileSync(new URL("./portal-workspace.tsx", import.meta.url), "utf8");
const video = readFileSync(new URL("./authenticated-video.tsx", import.meta.url), "utf8");

test("Teacher and Student responsive portal navigation includes Core Learning", () => {
  assert.match(portal, /"overview", "classes", "learning"/);
  assert.match(portal, /"overview", "learning", "homework"/);
  assert.match(portal, /className="flex gap-2 overflow-x-auto/);
  assert.match(portal, /active === "learning"\) return <TeacherLmsWorkspace/);
  assert.match(portal, /active === "learning"\) return <StudentLmsWorkspace/);
});

test("Teacher workspace uses authorized Lesson management without Module creation", () => {
  const teacher = workspace.slice(workspace.indexOf("export function TeacherLmsWorkspace"), workspace.indexOf("export function StudentLmsWorkspace"));
  assert.match(teacher, /\/admin\/lms\/lessons\?limit=100/);
  assert.match(teacher, /\/admin\/lms\/options/);
  assert.match(teacher, /method: editing \? "PATCH" : "POST"/);
  assert.match(teacher, /Publish/);
  assert.match(teacher, /Archive/);
  assert.match(teacher, /Permanently delete archived Lesson/);
  assert.match(teacher, /canManage=\{false\}/);
  assert.match(teacher, /options\.allocations\.some\(allocation => allocation\.branchId === form\.branchId && allocation\.courseId === form\.courseId && allocation\.batchId === form\.batchId && allocation\.subjectId === item\.subject\.id\)/);
  assert.match(teacher, /update\("moduleId", ""\)/);
  assert.doesNotMatch(teacher, /\/admin\/lms\/modules/);
});

test("Teacher visible Lesson order is submitted as the numeric API position", () => {
  const payload = teacherLessonRequestPayload({ title: "Creation test", description: "Description", moduleId: "module", branchId: "branch", courseId: "course", batchId: "batch", subjectId: "subject", teacherId: "teacher", chapter: "Chapter", videoUrl: "", notes: "", durationSeconds: 300, position: lessonOrderFromInput("99"), preview: false, status: "DRAFT", homeworkId: "", testId: "", video: null, attachments: [] });
  assert.equal(payload.position, 99);
  assert.equal(typeof payload.position, "number");
  assert.match(workspace, /Lesson order[^]*update\("position", lessonOrderFromInput\(event\.target\.value\)\)/);
  assert.match(workspace, /JSON\.stringify\(teacherLessonRequestPayload\(form\)\)/);
});

test("Teacher workspace separates bootstrap failure, missing allocation and normal Lesson states", () => {
  const teacher = workspace.slice(workspace.indexOf("export function TeacherLmsWorkspace"), workspace.indexOf("export function StudentLmsWorkspace"));
  assert.match(teacher, /bootstrapError/);
  assert.match(teacher, /Unable to load Learning/);
  assert.match(teacher, /Try again/);
  assert.match(teacher, /if \(bootstrapError\) return/);
  assert.match(teacher, /if \(!options\.allocations\.length\) return/);
  assert.match(teacher, /No active teaching allocation is available for Learning/);
  assert.match(teacher, /Ask an administrator to configure your Teacher Allocation/);
  assert.ok(teacher.indexOf('if (!options.allocations.length) return') < teacher.indexOf('Add Lesson'));
});

test("Teacher workspace securely previews video, attachments and owned progress", () => {
  const teacher = workspace.slice(workspace.indexOf("export function TeacherLmsWorkspace"), workspace.indexOf("export function StudentLmsWorkspace"));
  assert.match(teacher, /<LessonMedia lesson=\{viewing\}/);
  assert.match(teacher, /downloadAttachment\(item\)/);
  assert.match(teacher, /Student progress/);
});

test("Student workspace has controlled loading, error and empty states", () => {
  const student = workspace.slice(workspace.indexOf("export function StudentLmsWorkspace"));
  assert.match(student, /aria-label="Loading Learning"/);
  assert.match(student, /Unable to load Learning/);
  assert.match(student, /aria-label="Empty Learning"/);
  assert.match(student, /No published Lessons are assigned to your active Batch/);
});

test("Student workspace groups Course, Module and Lesson without management actions", () => {
  const student = workspace.slice(workspace.indexOf("export function StudentLmsWorkspace"));
  assert.match(student, /lesson\.course\.id.*lesson\.module\.id/);
  assert.match(student, /Module \{group\.position\}: \{group\.module\}/);
  assert.match(student, /lesson\.teacher\.user\.name/);
  assert.doesNotMatch(student, /Add Lesson|Edit Lesson|\/admin\/lms/);
});

test("Student media, attachment and progress use secured Core LMS endpoints", () => {
  const student = workspace.slice(workspace.indexOf("export function StudentLmsWorkspace"));
  assert.match(student, /request\("\/learning\/lms\/me"\)/);
  assert.match(student, /`\/learning\/lms\/lessons\/\$\{lesson\.id\}\/progress`/);
  assert.match(student, /lastPositionSeconds: position/);
  assert.match(student, /Math\.max\(previous, Math\.round\(positions\[lesson\.id\]/);
  assert.match(student, /Save progress/);
  assert.match(student, /Mark complete/);
  assert.match(workspace, /\/learning\/lms\/attachments\/\$\{attachment\.id\}/);
  assert.match(workspace, /<AuthenticatedVideo[^]*\/learning\/lms\/lessons\/\$\{lesson\.id\}\/video/);
});

test("AuthenticatedVideo resumes safely and never places a token in its URL", () => {
  assert.match(video, /Authorization: `Bearer \$\{getAccessToken\(\) \?\? ""\}`/);
  assert.match(video, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(video, /event\.currentTarget\.currentTime = initialTime/);
  assert.match(video, /onTimeUpdate\?\./);
  assert.doesNotMatch(video, /[?&](?:token|access_token)=/);
});
