import { test } from "@playwright/test";
import { assertSafeTarget, expectHealthyPage, login } from "./support/environment";

const adminPages: Array<[string, RegExp]> = [
  ["/admin", /overview/i],
  ["/admin/organizations", /organization/i],
  ["/admin/branches", /branches/i],
  ["/admin/academic-sessions", /academic sessions/i],
  ["/admin/classrooms", /classroom/i],
  ["/admin/students", /student/i],
  ["/admin/teachers", /faculty|teachers/i],
  ["/admin/users", /user management/i],
  ["/admin/courses", /course/i],
  ["/admin/subjects", /subject/i],
  ["/admin/batches", /batch|section|group/i],
  ["/admin/teacher-allocations", /allocation/i],
  ["/admin/timetables", /timetable/i],
  ["/admin/attendance", /attendance/i],
  ["/admin/leaves", /leave/i],
  ["/admin/homeworks", /homework/i],
  ["/admin/tests", /test|assessment/i],
  ["/admin/examination-submissions", /question papers|answer sheets/i],
  ["/admin/lms", /learning|lesson|lms/i],
  ["/admin/enquiries", /admissions|crm|enquir/i],
  ["/admin/fees", /fees|finance/i],
  ["/admin/finance", /finance|accounting/i],
  ["/admin/hr", /hr|payroll/i],
  ["/admin/communication", /communication/i],
  ["/admin/notices", /notice/i],
  ["/admin/reports", /reports/i],
  ["/admin/settings", /settings/i],
];


const branchAdminPages: Array<[string, RegExp]> = [
  ["/admin", /overview/i],
  ["/admin/students", /student/i],
  ["/admin/teachers", /faculty|teacher/i],
  ["/admin/courses", /course/i],
  ["/admin/batches", /batch|section|group/i],
  ["/admin/attendance", /attendance/i],
  ["/admin/homeworks", /homework/i],
  ["/admin/lms", /learning|lesson|lms/i],
  ["/admin/enquiries", /admissions|crm|enquir/i],
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


test("@smoke branch admin core modules load without server errors", async ({ page }) => {
  await login(page, "branchAdmin");
  for (const [path, heading] of branchAdminPages) {
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
