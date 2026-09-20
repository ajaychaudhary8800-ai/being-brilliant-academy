import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("attendance writes reach the role-aware attendance router before admin reports", async () => {
  const source = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  const attendance = source.indexOf('app.use("/api/v1/attendance", attendance);');
  const reports = source.indexOf('app.use("/api/v1/attendance", onlyPaths(["/reports"], attendanceReports));');
  assert.ok(attendance >= 0, "attendance router must be mounted directly");
  assert.ok(reports > attendance, "admin reports must not intercept attendance writes");
});

test("teacher examination management never links to or authorizes an admin page", async () => {
  const portal = await readFile(new URL("../../web/components/portal-workspace.tsx", import.meta.url), "utf8");
  const adminPage = await readFile(new URL("../../web/app/admin/examination-submissions/page.tsx", import.meta.url), "utf8");
  const teacherPage = await readFile(new URL("../../web/app/teacher/examinations/page.tsx", import.meta.url), "utf8");
  assert.match(portal, /href="\/teacher\/examinations"/);
  assert.doesNotMatch(portal, /href="\/admin\/examination-submissions"/);
  assert.match(adminPage, /roles=\{\["SUPER_ADMIN", "BRANCH_ADMIN"\]\}/);
  assert.match(teacherPage, /roles=\{\["TEACHER"\]\}/);
});

test("parent homework evaluation and user account editing are exposed", async () => {
  const portal = await readFile(new URL("../../web/components/portal-workspace.tsx", import.meta.url), "utf8");
  const users = await readFile(new URL("../../web/app/admin/users/page.tsx", import.meta.url), "utf8");
  assert.match(portal, /Homework results/);
  assert.match(portal, /Teacher feedback/);
  assert.match(users, /Edit account/);
  assert.match(users, /method: "PATCH"/);
});
