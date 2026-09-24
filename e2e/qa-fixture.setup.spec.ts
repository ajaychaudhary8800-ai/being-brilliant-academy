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

  const [teacherDashboard, studentDashboard] = await Promise.all([
    apiJson<any>(request, teacher, "/api/v1/portal/teacher/dashboard"),
    apiJson<any>(request, student, "/api/v1/portal/student/dashboard"),
  ]);

  const studentUserId = student.user.id;
  if (teacherDashboard.data.students.some((item: any) => item.attendanceTargetId === studentUserId)) return;

  const teacherProfile = teacherDashboard.data.profile;
  const studentProfile = studentDashboard.data.profile;

  expect(teacherProfile.branch.id, "QA teacher and student must belong to the same staging branch").toBe(studentProfile.branch.id);
  expect(studentProfile.course?.id, "QA student must have an active course").toBeTruthy();
  expect(studentProfile.batch?.id, "QA student must have an active batch").toBeTruthy();
  const academicSessionName = typeof studentProfile.academicSession === "string"
    ? studentProfile.academicSession
    : studentProfile.academicSession?.name;
  expect(academicSessionName, "QA student must have an active academic session").toBeTruthy();

  const sessions = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/admin/academic-sessions?search=${encodeURIComponent(academicSessionName)}&status=all&limit=100`,
  );
  const academicSession = sessions.data.find(
    (item: any) => String(item.name).toLowerCase() === String(academicSessionName).toLowerCase(),
  );
  expect(academicSession?.id, "QA student's academic session must resolve through Academic Sessions").toBeTruthy();
  const academicSessionId = academicSession.id as string;

  const allocations = await apiJson<any>(
    request,
    superAdmin,
    `/api/v1/admin/teacher-allocations?teacherId=${encodeURIComponent(teacherProfile.id)}&status=ACTIVE&limit=100`,
  );

  const sameCourse = allocations.data.find((item: any) =>
    item.branchId === studentProfile.branch.id &&
    item.courseId === studentProfile.course.id &&
    item.academicSessionId === academicSessionId,
  );

  expect(
    sameCourse,
    "QA teacher needs at least one active subject allocation in the QA student's course/session so the staging fixture can be aligned safely",
  ).toBeTruthy();

  const alreadyAllocated = allocations.data.find((item: any) =>
    item.batchId === studentProfile.batch.id &&
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
          academicSessionId: academicSessionId,
          branchId: studentProfile.branch.id,
          courseId: studentProfile.course.id,
          batchId: studentProfile.batch.id,
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
