import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { HomeworkStatus, HomeworkSubmissionStatus, Role, StudentStatus } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import studentHomeworks from "./student-homeworks.js";
import teacherHomeworks from "./teacher-homeworks.js";

const ORGANIZATION_ID = "organization-student-route-test";
const OTHER_ORGANIZATION_ID = "organization-other-route-test";
const HOMEWORK_ID = "clw9p8x7y0001abcd1234efgh";
const BATCH_ID = "batch-student-route-test";
const COURSE_ID = "course-student-route-test";
const BRANCH_ID = "branch-student-route-test";
const SUBJECT_ID = "subject-student-route-test";
const STUDENT_USER_ID = "student-user-route-test";
const STUDENT_ID = "student-profile-route-test";
const TEACHER_USER_ID = "teacher-user-route-test";
const TEACHER_ID = "teacher-profile-route-test";
const OTHER_TEACHER_USER_ID = "other-teacher-user-route-test";
const OTHER_TEACHER_ID = "other-teacher-profile-route-test";
const CROSS_TENANT_TEACHER_USER_ID = "cross-tenant-teacher-user-route-test";

type StoredSubmission = {
  id: string;
  organizationId: string;
  homeworkId: string;
  studentId: string;
  submittedAt: Date;
  status: HomeworkSubmissionStatus;
  answerText: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachmentSize: number | null;
  attachmentData: Buffer | null;
  marksObtained: number | null;
  feedback: string | null;
  evaluatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type StoredAudit = {
  organizationId: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: unknown;
};

type Store = { submissions: StoredSubmission[]; audits: StoredAudit[] };

const copyStore = (value: Store): Store => ({
  submissions: value.submissions.map(row => ({
    ...row,
    submittedAt: new Date(row.submittedAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    evaluatedAt: row.evaluatedAt ? new Date(row.evaluatedAt) : null,
    attachmentData: row.attachmentData ? Buffer.from(row.attachmentData) : null,
  })),
  audits: value.audits.map(row => ({ ...row })),
});

test("Student Homework production routes persist, protect and expose submissions behaviorally", async t => {
  let store: Store;
  let homework = homeworkFixture();
  let student = studentFixture();
  let failAudit = false;
  let injectedTransactionCode: string | null = null;
  let duplicateRace = false;
  let raceEntrants = 0;
  let releaseRace: (() => void) | null = null;
  let raceGate = Promise.resolve();
  let staleOnUpdate = false;
  let updateWhere: Record<string, unknown> | null = null;
  let transactionIsolation: string | null = null;
  let sequence = 0;

  function homeworkFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: HOMEWORK_ID,
      organizationId: ORGANIZATION_ID,
      title: "Route-tested Homework",
      description: "Behavioral Student submission fixture",
      type: "ASSIGNMENT",
      assignedDate: new Date("2099-01-01T09:00:00.000Z"),
      dueDate: new Date("2099-01-02T09:00:00.000Z"),
      maximumMarks: 20,
      status: HomeworkStatus.PUBLISHED,
      remarks: null,
      attachmentName: null,
      attachmentMime: null,
      attachmentSize: null,
      createdAt: new Date("2099-01-01T09:00:00.000Z"),
      updatedAt: new Date("2099-01-01T09:00:00.000Z"),
      branchId: BRANCH_ID,
      courseId: COURSE_ID,
      batchId: BATCH_ID,
      subjectId: SUBJECT_ID,
      teacherId: TEACHER_ID,
      timetableId: null,
      ...overrides,
    };
  }

  function studentFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: STUDENT_ID,
      userId: STUDENT_USER_ID,
      organizationId: ORGANIZATION_ID,
      batchId: BATCH_ID,
      status: StudentStatus.ACTIVE,
      user: { name: "Route Test Student", isActive: true },
      batch: { courseId: COURSE_ID },
      ...overrides,
    };
  }

  function reset() {
    store = { submissions: [], audits: [] };
    homework = homeworkFixture();
    student = studentFixture();
    failAudit = false;
    injectedTransactionCode = null;
    duplicateRace = false;
    raceEntrants = 0;
    releaseRace = null;
    raceGate = Promise.resolve();
    staleOnUpdate = false;
    updateWhere = null;
    transactionIsolation = null;
  }

  function nextDate() {
    sequence += 1;
    return new Date(Date.UTC(2099, 0, 1, 10, 0, sequence));
  }

  function selectedSubmission(row: StoredSubmission) {
    return {
      id: row.id,
      submittedAt: row.submittedAt,
      status: row.status,
      attachmentName: row.attachmentName,
      attachmentSize: row.attachmentSize,
      answerText: row.answerText,
      student: { id: STUDENT_ID, admissionNo: "BBA-ROUTE-1", user: { name: "Route Test Student" } },
    };
  }

  function fullHomework() {
    return {
      ...homework,
      branch: { id: BRANCH_ID, branchName: "Route Branch", branchCode: "RB" },
      course: { id: COURSE_ID, title: "Route Course", courseCode: "RC" },
      batch: { id: BATCH_ID, name: "Route Batch", code: "RB1" },
      subject: { id: SUBJECT_ID, name: "Route Subject", code: "RS" },
      teacher: { id: TEACHER_ID, employeeNo: "T-ROUTE", user: { name: "Owning Teacher", email: "teacher@example.test" } },
      timetable: null,
      submissions: store.submissions.map(row => ({
        ...selectedSubmission(row),
        attachmentMime: row.attachmentMime,
        marksObtained: row.marksObtained,
        feedback: row.feedback,
        evaluatedAt: row.evaluatedAt,
        student: { id: STUDENT_ID, admissionNo: "BBA-ROUTE-1", rollNo: "1", user: { name: "Route Test Student", email: "student@example.test" } },
      })),
      _count: { submissions: store.submissions.length },
    };
  }

  function matchesSubmission(row: StoredSubmission, where: Record<string, any>) {
    return (!where.id || row.id === where.id)
      && (!where.organizationId || row.organizationId === where.organizationId)
      && (!where.homeworkId || row.homeworkId === where.homeworkId)
      && (!where.studentId || row.studentId === where.studentId)
      && (!where.updatedAt || row.updatedAt.getTime() === new Date(where.updatedAt).getTime())
      && (!where.status?.in || where.status.in.includes(row.status));
  }

  function transactionClient(local: Store) {
    return {
      homework: {
        findFirst: async ({ where }: any) => where.id === homework.id && where.organizationId === homework.organizationId
          ? { status: homework.status }
          : null,
      },
      homeworkSubmission: {
        findFirst: async ({ where }: any) => {
          const row = local.submissions.find(candidate => matchesSubmission(candidate, where));
          return row ? { id: row.id, status: row.status, updatedAt: row.updatedAt } : null;
        },
        create: async ({ data }: any) => {
          if (local.submissions.some(row => row.homeworkId === data.homeworkId && row.studentId === data.studentId)) {
            throw { code: "P2002" };
          }
          const timestamp = nextDate();
          const row: StoredSubmission = {
            id: `submission-route-${++sequence}`,
            organizationId: data.organizationId,
            homeworkId: data.homeworkId,
            studentId: data.studentId,
            submittedAt: data.submittedAt,
            status: data.status,
            answerText: data.answerText ?? null,
            attachmentName: data.attachmentName ?? null,
            attachmentMime: data.attachmentMime ?? null,
            attachmentSize: data.attachmentSize ?? null,
            attachmentData: data.attachmentData ?? null,
            marksObtained: null,
            feedback: null,
            evaluatedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          local.submissions.push(row);
          return selectedSubmission(row);
        },
        updateMany: async ({ where, data }: any) => {
          updateWhere = where;
          if (staleOnUpdate) {
            staleOnUpdate = false;
            const committed = store.submissions.find(row => row.id === where.id)!;
            committed.answerText = "Request B won";
            committed.updatedAt = nextDate();
            const localRow = local.submissions.find(row => row.id === where.id)!;
            localRow.answerText = committed.answerText;
            localRow.updatedAt = committed.updatedAt;
          }
          const row = local.submissions.find(candidate => matchesSubmission(candidate, where));
          if (!row) return { count: 0 };
          Object.assign(row, data, { updatedAt: nextDate() });
          return { count: 1 };
        },
        findFirstOrThrow: async ({ where }: any) => {
          const row = local.submissions.find(candidate => matchesSubmission(candidate, where));
          if (!row) throw new Error("Expected submission was not found");
          return selectedSubmission(row);
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          if (failAudit) throw new Error("Simulated AuditLog failure");
          local.audits.push({ ...data });
          return data;
        },
      },
    };
  }

  const patches: Array<() => void> = [];
  function patch(target: any, property: string, replacement: (...args: any[]) => any) {
    const original = target[property];
    target[property] = replacement;
    patches.unshift(() => { target[property] = original; });
  }

  reset();
  patch((systemPrisma as any).organization, "findUnique", async ({ where }: any) => ({
    id: where.id,
    isActive: true,
    deletedAt: null,
    subscriptionStatus: "ACTIVE",
    trialEndsAt: null,
    subscriptionEndsAt: null,
  }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).studentProfile, "findFirst", async ({ where }: any) => (
    where.userId === student.userId && where.organizationId === student.organizationId ? student : null
  ));
  patch((prisma as any).teacherProfile, "findFirst", async ({ where }: any) => {
    if (where.userId === TEACHER_USER_ID && where.organizationId === ORGANIZATION_ID) {
      return { id: TEACHER_ID, organizationId: ORGANIZATION_ID, branchId: BRANCH_ID, user: { name: "Owning Teacher", isActive: true } };
    }
    if (where.userId === OTHER_TEACHER_USER_ID && where.organizationId === ORGANIZATION_ID) {
      return { id: OTHER_TEACHER_ID, organizationId: ORGANIZATION_ID, branchId: BRANCH_ID, user: { name: "Other Teacher", isActive: true } };
    }
    if (where.userId === CROSS_TENANT_TEACHER_USER_ID && where.organizationId === OTHER_ORGANIZATION_ID) {
      return { id: "cross-tenant-teacher", organizationId: OTHER_ORGANIZATION_ID, branchId: "other-branch", user: { name: "Cross Tenant Teacher", isActive: true } };
    }
    return null;
  });
  patch((prisma as any).teacherProfile, "findUnique", async ({ where }: any) => where.userId === TEACHER_USER_ID
    ? { id: TEACHER_ID, branchId: BRANCH_ID }
    : where.userId === OTHER_TEACHER_USER_ID
      ? { id: OTHER_TEACHER_ID, branchId: BRANCH_ID }
      : null);
  patch((prisma as any).homework, "findFirst", async ({ where }: any) => (
    where.id === homework.id && where.organizationId === homework.organizationId ? homework : null
  ));
  patch((prisma as any).homework, "findUnique", async ({ where }: any) => where.id === homework.id ? fullHomework() : null);
  patch((prisma as any).homework, "count", async ({ where }: any) => {
    if (where.teacherId && where.teacherId !== TEACHER_ID) return 0;
    if (where.status && where.status !== homework.status) return 0;
    if (where.dueDate?.lt && !(homework.dueDate < where.dueDate.lt)) return 0;
    return 1;
  });
  patch((prisma as any).homeworkSubmission, "count", async ({ where }: any) => store.submissions.filter(row => (
    (!where.status?.in || where.status.in.includes(row.status))
    && (!where.homework?.teacherId || where.homework.teacherId === TEACHER_ID)
  )).length);
  patch(prisma as any, "$transaction", async (operation: any, options: any) => {
    transactionIsolation = options?.isolationLevel ?? null;
    if (injectedTransactionCode) {
      const code = injectedTransactionCode;
      injectedTransactionCode = null;
      throw { code };
    }
    const before = copyStore(store);
    const local = copyStore(store);
    if (duplicateRace) {
      if (raceEntrants === 0) raceGate = new Promise<void>(resolve => { releaseRace = resolve; });
      raceEntrants += 1;
      if (raceEntrants === 2) releaseRace?.();
      await raceGate;
    }
    const result = await operation(transactionClient(local));
    const newlyCreated = local.submissions.filter(row => !before.submissions.some(previous => previous.id === row.id));
    if (newlyCreated.some(row => store.submissions.some(committed => committed.homeworkId === row.homeworkId && committed.studentId === row.studentId))) {
      throw { code: "P2002" };
    }
    store = local;
    return result;
  });

  const application = express();
  application.use(express.json({ limit: "12mb" }));
  application.use("/api/v1/student", studentHomeworks);
  application.use("/api/v1/teacher", teacherHomeworks);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;

  const token = (userId: string, role: Role, organizationId = ORGANIZATION_ID) => jwt.sign(
    { userId, role, organizationId },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "5m" },
  );
  const studentToken = () => token(STUDENT_USER_ID, Role.STUDENT);
  async function request(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const payload = await response.json() as any;
    return { status: response.status, payload };
  }
  const submit = (body: unknown, suppliedToken = studentToken()) => request(
    `/api/v1/student/homeworks/${HOMEWORK_ID}/submissions`,
    { method: "POST", token: suppliedToken, body },
  );

  try {
    await t.test("actual HTTP route enforces authentication and Student-only role", async () => {
      reset();
      assert.equal((await request(`/api/v1/student/homeworks/${HOMEWORK_ID}/submissions`, { method: "POST", body: { answerText: "answer" } })).status, 401);
      for (const role of [Role.TEACHER, Role.PARENT, Role.SUPER_ADMIN, Role.BRANCH_ADMIN]) {
        const response = await submit({ answerText: "answer" }, token(`role-${role}`, role));
        assert.equal(response.status, 403);
        assert.equal(response.payload.error.code, "FORBIDDEN");
      }
      assert.equal(store.submissions.length, 0);
    });

    await t.test("authoritative active profile, tenant, batch and strict identity checks deny invalid requests", async () => {
      reset();
      student = studentFixture({ user: { name: "Route Test Student", isActive: false } });
      assert.equal((await submit({ answerText: "answer" })).payload.error.code, "INACTIVE_ACCOUNT");
      student = studentFixture({ status: StudentStatus.INACTIVE });
      assert.equal((await submit({ answerText: "answer" })).payload.error.code, "STUDENT_NOT_ELIGIBLE");
      student = studentFixture({ batchId: "other-batch" });
      assert.equal((await submit({ answerText: "answer" })).status, 403);
      student = studentFixture();
      homework = homeworkFixture({ organizationId: OTHER_ORGANIZATION_ID });
      assert.equal((await submit({ answerText: "answer" })).status, 404);
      homework = homeworkFixture();
      for (const field of ["studentId", "studentProfileId", "organizationId", "batchId", "courseId"]) {
        const response = await submit({ answerText: "answer", [field]: "spoofed-value" });
        assert.equal(response.status, 422);
      }
      assert.equal((await submit({ answerText: "   " })).payload.error.code, "SUBMISSION_CONTENT_REQUIRED");
      assert.equal(store.submissions.length, 0);
    });

    await t.test("first text-only submission persists once with server identity and atomic AuditLog", async () => {
      reset();
      const response = await submit({ answerText: "  Persisted route answer  " });
      assert.equal(response.status, 201);
      assert.equal(store.submissions.length, 1);
      const saved = store.submissions[0]!;
      assert.equal(saved.homeworkId, HOMEWORK_ID);
      assert.equal(saved.studentId, STUDENT_ID);
      assert.equal(saved.organizationId, ORGANIZATION_ID);
      assert.equal(saved.answerText, "Persisted route answer");
      assert.equal(saved.status, HomeworkSubmissionStatus.SUBMITTED);
      assert.equal(transactionIsolation, "Serializable");
      assert.equal(store.audits.length, 1);
      assert.deepEqual(store.audits[0], {
        organizationId: ORGANIZATION_ID,
        actorId: STUDENT_USER_ID,
        action: "CREATE",
        entity: "HomeworkSubmission",
        entityId: saved.id,
        metadata: { homeworkId: HOMEWORK_ID, studentProfileId: STUDENT_ID },
      });

      const dashboard = await request("/api/v1/teacher/homeworks/dashboard", { token: token(TEACHER_USER_ID, Role.TEACHER) });
      assert.equal(dashboard.status, 200);
      assert.equal(dashboard.payload.data.submissions, 1);
      assert.equal(dashboard.payload.data.pendingEvaluation, 1);
      const detail = await request(`/api/v1/teacher/homeworks/${HOMEWORK_ID}`, { token: token(TEACHER_USER_ID, Role.TEACHER) });
      assert.equal(detail.status, 200);
      assert.equal(detail.payload.data.submissions[0].id, saved.id);
      assert.equal((await request(`/api/v1/teacher/homeworks/${HOMEWORK_ID}`, { token: token(OTHER_TEACHER_USER_ID, Role.TEACHER) })).status, 403);
      assert.equal((await request(`/api/v1/teacher/homeworks/${HOMEWORK_ID}`, { token: token(CROSS_TENANT_TEACHER_USER_ID, Role.TEACHER, OTHER_ORGANIZATION_ID) })).status, 404);
    });

    await t.test("server time marks a first submission after the deadline LATE", async () => {
      reset();
      homework = homeworkFixture({ dueDate: new Date("2000-01-01T00:00:00.000Z") });
      const response = await submit({ answerText: "late route answer" });
      assert.equal(response.status, 201);
      assert.equal(store.submissions[0]!.status, HomeworkSubmissionStatus.LATE);
    });

    await t.test("AuditLog failure rolls back the submission transaction", async () => {
      reset();
      failAudit = true;
      const response = await submit({ answerText: "must roll back" });
      assert.equal(response.status, 500);
      assert.equal(store.submissions.length, 0);
      assert.equal(store.audits.length, 0);
    });

    await t.test("competing first submissions yield one record and a safe P2002 conflict", async () => {
      reset();
      duplicateRace = true;
      const responses = await Promise.all([
        submit({ answerText: "competing answer A" }),
        submit({ answerText: "competing answer B" }),
      ]);
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
      assert.equal(responses.find(response => response.status === 409)!.payload.error.code, "SUBMISSION_CHANGED");
      assert.equal(store.submissions.length, 1);
      assert.equal(store.audits.length, 1);
    });

    await t.test("SUBMITTED replacement mutates the same row, stores a verified file and resets review data", async () => {
      reset();
      await submit({ answerText: "original answer" });
      const original = store.submissions[0]!;
      const originalId = original.id;
      original.marksObtained = 10;
      original.feedback = "not yet final";
      original.evaluatedAt = new Date("2099-01-01T11:00:00.000Z");
      const response = await submit({
        answerText: "replacement answer",
        attachment: { name: "replacement.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-route replacement").toString("base64") },
      });
      assert.equal(response.status, 201);
      assert.equal(store.submissions.length, 1);
      const saved = store.submissions[0]!;
      assert.equal(saved.id, originalId);
      assert.equal(saved.answerText, "replacement answer");
      assert.equal(saved.attachmentName, "replacement.pdf");
      assert.equal(saved.attachmentMime, "application/pdf");
      assert.ok(saved.attachmentSize! > 0);
      assert.equal(saved.marksObtained, null);
      assert.equal(saved.feedback, null);
      assert.equal(saved.evaluatedAt, null);
      assert.equal(store.audits.at(-1)!.action, "REPLACE");
      assert.ok(updateWhere?.updatedAt instanceof Date);
      assert.deepEqual((updateWhere?.status as any).in, [HomeworkSubmissionStatus.SUBMITTED, HomeworkSubmissionStatus.LATE]);
    });

    await t.test("stale updatedAt replacement affects zero rows and preserves the competing request", async () => {
      reset();
      await submit({ answerText: "original answer" });
      staleOnUpdate = true;
      const response = await submit({ answerText: "stale request A" });
      assert.equal(response.status, 409);
      assert.equal(store.submissions[0]!.answerText, "Request B won");
      assert.equal(store.audits.length, 1);
    });

    await t.test("P2002 and P2034 transaction errors map to SUBMISSION_CHANGED", async () => {
      for (const code of ["P2002", "P2034"]) {
        reset();
        injectedTransactionCode = code;
        const response = await submit({ answerText: `injected ${code}` });
        assert.equal(response.status, 409);
        assert.equal(response.payload.error.code, "SUBMISSION_CHANGED");
        assert.equal(store.submissions.length, 0);
        assert.equal(store.audits.length, 0);
      }
    });

    await t.test("EVALUATED and RETURNED rows are immutable through the production mutation path", async () => {
      for (const status of [HomeworkSubmissionStatus.EVALUATED, HomeworkSubmissionStatus.RETURNED]) {
        reset();
        await submit({ answerText: "initial answer" });
        const saved = store.submissions[0]!;
        saved.status = status;
        saved.answerText = `${status} answer`;
        const response = await submit({ answerText: "forbidden replacement" });
        assert.equal(response.status, 409);
        assert.equal(response.payload.error.code, "SUBMISSION_REVIEW_STARTED");
        assert.equal(store.submissions.length, 1);
        assert.equal(store.submissions[0]!.answerText, `${status} answer`);
        assert.equal(store.audits.length, 1);
      }
    });

    await t.test("DRAFT, CLOSED and ARCHIVED Homework reject Student submissions", async () => {
      for (const status of [HomeworkStatus.DRAFT, HomeworkStatus.CLOSED, HomeworkStatus.ARCHIVED]) {
        reset();
        homework = homeworkFixture({ status });
        const response = await submit({ answerText: "not open" });
        assert.equal(response.status, 409);
        assert.equal(response.payload.error.code, "HOMEWORK_NOT_OPEN");
        assert.equal(store.submissions.length, 0);
      }
    });

    await t.test("invalid file bytes are rejected before persistence", async () => {
      reset();
      const response = await submit({
        attachment: { name: "answer.pdf", mimeType: "application/pdf", base64: Buffer.from("not a PDF").toString("base64") },
      });
      assert.equal(response.status, 422);
      assert.equal(store.submissions.length, 0);
      assert.equal(store.audits.length, 0);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const restore of patches) restore();
  }
});
