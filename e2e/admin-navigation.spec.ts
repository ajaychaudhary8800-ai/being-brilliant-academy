import { test } from "@playwright/test";
import { assertSafeTarget, expectHealthyPage, login } from "./support/environment";

const adminPages: Array<[string, RegExp]> = [
  ["/admin", /dashboard/i],
  ["/admin/organizations", /organizations/i],
  ["/admin/branches", /branches/i],
  ["/admin/academic-sessions", /academic sessions/i],
  ["/admin/classrooms", /classrooms/i],
  ["/admin/students", /students/i],
  ["/admin/teachers", /faculty|teachers/i],
  ["/admin/users", /user management/i],
  ["/admin/courses", /courses/i],
  ["/admin/subjects", /subject/i],
  ["/admin/batches", /batches/i],
  ["/admin/teacher-allocations", /allocation/i],
  ["/admin/timetables", /timetable/i],
  ["/admin/attendance", /attendance/i],
  ["/admin/leaves", /leave/i],
  ["/admin/homeworks", /homework/i],
  ["/admin/tests", /tests|assessments/i],
  ["/admin/examination-submissions", /question papers|answer sheets/i],
  ["/admin/lms", /learning|lesson|lms/i],
  ["/admin/enquiries", /enquir/i],
  ["/admin/fees", /fees/i],
  ["/admin/finance", /finance|accounting/i],
  ["/admin/hr", /hr|payroll/i],
  ["/admin/communication", /communication/i],
  ["/admin/notices", /notice/i],
  ["/admin/reports", /reports/i],
  ["/admin/settings", /settings/i],
];

test.beforeAll(({ baseURL }) => assertSafeTarget(baseURL ?? "http://127.0.0.1:3000"));

test("@smoke super admin critical modules load without server errors", async ({ page }) => {
  await login(page, "superAdmin");
  for (const [path, heading] of adminPages) {
    await test.step(path, async () => {
      await page.goto(path);
      await expectHealthyPage(page, heading);
    });
  }
});

test("@smoke accountant finance workspace loads", async ({ page }) => {
  await login(page, "accountant");
  await page.goto("/admin/finance");
  await expectHealthyPage(page, /finance|accounting/i);
});
