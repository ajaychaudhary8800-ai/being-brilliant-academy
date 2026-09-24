import { expect, test } from "@playwright/test";
import { apiJson, loginApi } from "./support/api";
import { assertSafeTarget } from "./support/environment";

test("@fixture align QA teacher with QA student batch", async ({ request, baseURL }) => {
  assertSafeTarget(baseURL ?? "http://127.0.0.1:3000", true);

  const [superAdmin, teacher, student] = await Promise.all([
    loginApi(request, "superAdmin"),
    loginApi(request, "teacher"),
    loginApi(request, "student"),
  ]);

  const [teacherDashboard, studentDashboard, adminStudents] = await Promise.all([
    apiJson<any>(request, teacher, "/api/v1/portal/teacher/dashboard"),
    apiJson<any>(request, student, "/api/v1/portal/student/dashboard"),
    apiJson<any>(
      request,
      superAdmin,
      `/api/v1/admin/students?search=${encodeURIComponent(student.user.email)}&status=ACTIVE&page=1&limit=20`,
    ),
  ]);

  const studentUserId = student.user.id;
  if (teacherDashboard.data.students.some((item: any) => item.attendanceTargetId === studentUserId)) return;

  const teacherProfile = teacherDashboard.data.profile;
  const studentProfile = studentDashboard.data.profile;
  const adminStudent = adminStudents.data.find((item: any) => item.user?.id === studentUserId);

  expect(adminStudent, "QA student must be visible to the staging super admin").toBeTruthy();

  const branchId = adminStudent!.branchId ?? studentProfile.branch?.id;
  const courseId = adminStudent!.course?.id ?? adminStudent!.batch?.course?.id ?? studentProfile.course?.id;
  const batchId = adminStudent!.batchId ?? adminStudent!.batch?.id ?? studentProfile.batch?.id;
  const academicSessionId = adminStudent!.academicSessionId ?? adminStudent!.batch?.academicSessionId;

  expect(branchId, "QA student must have an active branch").toBeTruthy();
  expect(courseId, "QA student must have an active course").toBeTruthy();
  expect(batchId, "QA student must have an active batch").toBeTruthy();
  expect(academicSessionId, "QA student must have an active academic session").toBeTruthy();
  expect(teacherProfile.branch.id, "QA teacher and student must belong to the same staging branch").toBe(branchId);

  const allocations = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/admin/teacher-allocations?teacherId=${encodeURIComponent(teacherProfile.id)}&status=ACTIVE&limit=100`,
  );

  const sameCourse = allocations.data.find((item: any) =>
    item.branchId === branchId &&
    item.courseId === courseId &&
    item.academicSessionId === academicSessionId,
  );

  expect(
    sameCourse,
    "QA teacher needs at least one active subject allocation in the QA student's course/session so the staging fixture can be aligned safely",
  ).toBeTruthy();

  const alreadyAllocated = allocations.data.find((item: any) =>
    item.batchId === batchId &&
    item.subjectId === sameCourse.subjectId &&
    item.status === "ACTIVE",
  );

  if (!alreadyAllocated) {
    await apiJson(
      request,
      superAdmin,
      "/api/v1/admin/teacher-allocations",
      {
        method: "POST",
        data: {
          academicSessionId,
          branchId,
          courseId,
          batchId,
          teacherId: teacherProfile.id,
          subjectId: sameCourse.subjectId,
          weeklyPeriods: Math.max(1, Number(sameCourse.weeklyPeriods ?? 1)),
          effectiveFrom: new Date().toISOString().slice(0, 10),
          effectiveTo: null,
          remarks: "Automated QA fixture alignment",
          status: "ACTIVE",
        },
      },
    );
  }

  const refreshed = await apiJson<any>(request, teacher, "/api/v1/portal/teacher/dashboard");
  expect(
    refreshed.data.students.some((item: any) => item.attendanceTargetId === studentUserId),
    "QA teacher must see the QA student after fixture alignment",
  ).toBe(true);
});
