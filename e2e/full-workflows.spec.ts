import { expect, test } from "@playwright/test";
import { apiJson, loginApi } from "./support/api";
import { assertSafeTarget } from "./support/environment";

type TeacherDashboard = {
  data: {
    timeZone: string;
    profile: { id: string };
    myClasses: Array<{
      branch: { id: string };
      course: { id: string };
      batch: { id: string };
      subject: { id: string };
    }>;
    students: Array<{
      id: string;
      attendanceTargetId: string;
      batch: { id: string; name: string };
    }>;
  };
};

function localParts(date: Date, timeZone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]),
  ) as Record<string, string>;
}

function localDate(date: Date, timeZone: string) {
  const parts = localParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDateTime(date: Date, timeZone: string) {
  const parts = localParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

test("@workflow synthetic cross-role academic workflow", async ({ request, baseURL }) => {
  test.skip(process.env.QA_RUN_MUTATION_TESTS !== "true", "Mutation workflow suite is disabled");
  assertSafeTarget(baseURL ?? "http://127.0.0.1:3000", true);

  const [superAdmin, teacher, student, parent] = await Promise.all([
    loginApi(request, "superAdmin"),
    loginApi(request, "teacher"),
    loginApi(request, "student"),
    loginApi(request, "parent"),
  ]);

  const teacherDashboard = await apiJson<TeacherDashboard>(request, teacher, "/api/v1/portal/teacher/dashboard");
  const qaStudent = teacherDashboard.data.students.find(item => item.attendanceTargetId === student.user.id);
  expect(qaStudent, "QA teacher must be assigned to the QA student's active batch").toBeTruthy();

  const qaClass = teacherDashboard.data.myClasses.find(item => item.batch.id === qaStudent!.batch.id);
  expect(qaClass, "QA teacher needs an active subject allocation for the QA student's batch").toBeTruthy();

  const token = `qa-${Date.now()}`;
  const title = `Nightly workflow ${token}`;
  const now = new Date();
  const assignedDate = localDate(now, teacherDashboard.data.timeZone);
  const dueInstant = new Date(now.getTime() + (48 * 60 + (Date.now() % 29)) * 60_000);
  const dueDate = localDateTime(dueInstant, teacherDashboard.data.timeZone);

  const created = await apiJson<{ data: { id: string; status: string } }>(
    request,
    teacher,
    "/api/v1/teacher/homeworks",
    {
      method: "POST",
      data: {
        title,
        description: "Synthetic nightly QA assignment validating the teacher to student to parent workflow.",
        branchId: qaClass!.branch.id,
        courseId: qaClass!.course.id,
        batchId: qaClass!.batch.id,
        subjectId: qaClass!.subject.id,
        type: "HOMEWORK",
        assignedDate,
        dueDate,
        maximumMarks: 10,
        remarks: token,
      },
    },
  );
  expect(created.data.status).toBe("DRAFT");

  const published = await apiJson<{ data: { status: string } }>(
    request,
    teacher,
    `/api/v1/teacher/homeworks/${created.data.id}/status`,
    { method: "PATCH", data: { status: "PUBLISHED" } },
  );
  expect(published.data.status).toBe("PUBLISHED");

  const submission = await apiJson<{ data: { id: string; status: string } }>(
    request,
    student,
    `/api/v1/student/homeworks/${created.data.id}/submissions`,
    { method: "POST", data: { answerText: `Synthetic student answer ${token}` } },
  );
  expect(["SUBMITTED", "LATE"]).toContain(submission.data.status);

  const evaluation = await apiJson<{ data: { status: string; marksObtained: number; feedback: string } }>(
    request,
    teacher,
    `/api/v1/teacher/homeworks/submissions/${submission.data.id}/evaluate`,
    {
      method: "PATCH",
      data: {
        marksObtained: 8,
        feedback: `Nightly QA evaluation ${token}`,
        status: "EVALUATED",
      },
    },
  );
  expect(evaluation.data.status).toBe("EVALUATED");
  expect(evaluation.data.marksObtained).toBe(8);

  const parentDashboard = await apiJson<any>(request, parent, "/api/v1/portal/parent/dashboard");
  const parentHomework = parentDashboard.data.children
    .flatMap((child: any) => child.homework.assignments)
    .find((homework: any) => homework.id === created.data.id);
  expect(parentHomework, "Parent must see the linked child's evaluated homework").toBeTruthy();
  expect(parentHomework.submission?.marksObtained).toBe(8);
  expect(parentHomework.submission?.feedback).toContain(token);

  const message = await apiJson<{ data: { id: string } }>(
    request,
    teacher,
    "/api/v1/portal/messages",
    {
      method: "POST",
      data: {
        recipientId: student.user.id,
        subject: `QA message ${token}`,
        body: `Synthetic teacher message ${token}`,
      },
    },
  );
  const studentMessages = await apiJson<any>(
    request,
    student,
    `/api/v1/portal/messages?search=${encodeURIComponent(token)}&limit=20`,
  );
  expect(studentMessages.data.some((item: any) => item.id === message.data.id)).toBe(true);
  await apiJson(request, student, `/api/v1/portal/messages/${message.data.id}`, { method: "PATCH", data: { read: true } });

  await apiJson(
    request,
    student,
    "/api/v1/portal/messages",
    {
      method: "POST",
      data: {
        recipientId: teacher.user.id,
        subject: `QA reply ${token}`,
        body: `Synthetic student reply ${token}`,
      },
    },
  );
  const teacherMessages = await apiJson<any>(
    request,
    teacher,
    `/api/v1/portal/messages?search=${encodeURIComponent(token)}&limit=20`,
  );
  expect(teacherMessages.data.some((item: any) => item.subject === `QA reply ${token}`)).toBe(true);

  const lms = await apiJson<any>(request, student, "/api/v1/learning/lms/me");
  expect(lms.data.lessons.length, "QA student's batch needs at least one published LMS lesson").toBeGreaterThan(0);
  const lesson = lms.data.lessons[0];
  const previousPosition = Number(lesson.progress?.[0]?.lastPositionSeconds ?? 0);
  const durationSeconds = Math.max(Number(lesson.durationSeconds ?? 0), previousPosition + 1);
  const nextPosition = Math.min(durationSeconds, Math.max(previousPosition, 1) + 1);
  const progress = await apiJson<any>(
    request,
    student,
    `/api/v1/learning/lms/lessons/${lesson.id}/progress`,
    { method: "PATCH", data: { lastPositionSeconds: nextPosition, timeSpentSeconds: 1 } },
  );
  expect(progress.data.lastPositionSeconds).toBeGreaterThanOrEqual(previousPosition);

  const attendanceDate = assignedDate;
  const attendanceList = await apiJson<any>(
    request,
    teacher,
    `/api/v1/attendance?batchId=${qaStudent!.batch.id}&studentId=${student.user.id}&from=${attendanceDate}T00:00:00.000Z&to=${attendanceDate}T23:59:59.999Z&limit=100`,
  );
  let attendance = attendanceList.data.find((item: any) => item.student?.id === student.user.id);
  if (!attendance) {
    const marked = await apiJson<any>(
      request,
      teacher,
      "/api/v1/attendance",
      {
        method: "POST",
        data: {
          studentId: student.user.id,
          batchId: qaStudent!.batch.id,
          date: `${attendanceDate}T00:00:00.000Z`,
          status: "PRESENT",
          teacherId: teacherDashboard.data.profile.id,
          remarks: `Nightly QA attendance ${token}`,
        },
      },
    );
    attendance = marked.data;
  }
  expect(attendance.id).toBeTruthy();

  const studentDashboard = await apiJson<any>(request, student, "/api/v1/portal/student/dashboard");
  expect(studentDashboard.data.homework.assignments.some((item: any) => item.id === created.data.id)).toBe(true);
  expect(studentDashboard.data.attendance.records.some((item: any) => item.id === attendance.id)).toBe(true);

  const closed = await apiJson<{ data: { status: string } }>(
    request,
    teacher,
    `/api/v1/teacher/homeworks/${created.data.id}/status`,
    { method: "PATCH", data: { status: "CLOSED" } },
  );
  expect(closed.data.status).toBe("CLOSED");

  const archived = await apiJson<{ data: { status: string } }>(
    request,
    superAdmin,
    `/api/v1/admin/homeworks/${created.data.id}/status`,
    { method: "PATCH", data: { status: "ARCHIVED" } },
  );
  expect(archived.data.status).toBe("ARCHIVED");
});
