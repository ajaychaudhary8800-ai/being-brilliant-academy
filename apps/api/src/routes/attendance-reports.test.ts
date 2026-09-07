import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { attendancePdfResponse, attendanceReportInput, pdfReport } from "./attendance-reports.js";

const studentReport = {
  mode: "student" as const,
  period: { from: "2026-09-01", to: "2026-09-30" },
  filters: { branch: "Main", course: "Mathematics", batch: "Grade 8", student: "Asha", teacher: "All", status: "All" },
  summary: [{ id: "student-1", name: "Asha Student", identifier: "ADM-1", branch: "Main", course: "Mathematics", batch: "Grade 8", present: 1, absent: 0, late: 0, fullDayLeave: 0, halfDayLeave: 0, shortLeave: 0, leave: 0, excused: 0, total: 1, percentage: 100 }],
  totals: { present: 1, absent: 0, late: 0, fullDayLeave: 0, halfDayLeave: 0, shortLeave: 0, leave: 0, excused: 0, total: 1, averagePercentage: 100 },
  recordCount: 1,
} as Parameters<typeof pdfReport>[0];

const teacherReport = {
  ...studentReport,
  mode: "teacher" as const,
  filters: { branch: "Main", course: "All", batch: "All", student: "All", teacher: "Mr. Teacher", status: "All" },
  summary: [{ id: "teacher-1", name: "Mr. Teacher", identifier: "EMP-1", branch: "Main", present: 1, absent: 0, late: 0, fullDayLeave: 0, halfDayLeave: 0, shortLeave: 0, leave: 0, excused: 0, total: 1, percentage: 100 }],
} as Parameters<typeof pdfReport>[0];

function pdfText(report: Parameters<typeof pdfReport>[0]) {
  return pdfReport(report, "Being Brilliant Academy").toString("latin1");
}

test("student attendance PDF is valid, non-empty, visible, and contains report content", () => {
  const response = attendancePdfResponse(studentReport, "Being Brilliant Academy");
  assert.equal(response.status, 200);
  assert.equal(response.headers["Content-Type"], "application/pdf");
  assert.match(response.headers["Content-Disposition"], /attachment; filename=attendance-report\.pdf/);
  const pdf = response.body;
  const text = pdf.toString("latin1");
  assert.equal(text.slice(0, 8), "%PDF-1.4");
  assert.ok(pdf.length > 500);
  assert.match(text, /\/Type \/Page/);
  assert.match(text, /Student Attendance/);
  assert.match(text, /Asha Student/);
  assert.match(text, /30 565 Td/);
  assert.doesNotMatch(text, /30 810 Td/);
});

test("teacher attendance PDF uses teacher columns and contains teacher content", () => {
  const response = attendancePdfResponse(teacherReport, "Being Brilliant Academy");
  assert.equal(response.status, 200);
  assert.equal(response.headers["Content-Type"], "application/pdf");
  const text = response.body.toString("latin1");
  assert.match(text, /Teacher Attendance/);
  assert.match(text, /Teacher Name/);
  assert.match(text, /Mr\. Teacher/);
  assert.match(text, /EMP-1/);
});

test("attendance PDF paginates without placing text outside the page", () => {
  const report = { ...studentReport, summary: Array.from({ length: 40 }, (_, index) => ({ ...studentReport.summary[0], id: `student-${index}`, name: `Student ${index}` })), recordCount: 40 } as Parameters<typeof pdfReport>[0];
  const text = pdfText(report);
  assert.equal((text.match(/\/Type \/Page \/Parent/g) ?? []).length, 2);
  assert.doesNotMatch(text, /30 810 Td/);
});

test("attendance report route keeps PDF response, auth, tenant, branch, and filter guards", async () => {
  const route = await readFile(new URL("./attendance-reports.ts", import.meta.url), "utf8");
  assert.match(route, /router\.use\(requireAuth, allow\(Role\.SUPER_ADMIN, Role\.BRANCH_ADMIN\)\)/);
  assert.match(route, /const organizationId = req\.auth!\.organizationId/);
  assert.match(route, /organizationId, date: \{ gte: from, lt: to \}/);
  assert.match(route, /branchScope\(req, input\.branchId\)/);
  assert.doesNotMatch(route, /req\.query\.organizationId/);
  assert.match(route, /Content-Type.*application\/pdf/);
  assert.match(route, /Content-Disposition.*attendance-report\.pdf/);
  assert.match(route, /format = z\.enum\(\["pdf", "excel"\]\)\.parse\(req\.query\.format\)/);
  assert.match(route, /mode: z\.enum\(\["student", "teacher"\]\)/);
  assert.match(route, /Report start must be on or before report end/);
  assert.match(route, /Student filters cannot be used for teacher reports/);
});

test("invalid attendance report filters are rejected before querying", () => {
  assert.equal(attendanceReportInput.safeParse({ mode: "student" }).success, false);
  assert.equal(attendanceReportInput.safeParse({ mode: "teacher", month: "2026-09", courseId: "ckxxxxxxxxxxxxxxxxxxxxxxxx" }).success, false);
  assert.equal(attendanceReportInput.safeParse({ mode: "student", from: "2026-09-30", to: "2026-09-01" }).success, false);
});
