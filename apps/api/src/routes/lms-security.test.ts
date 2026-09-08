import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { LmsContentStatus, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import adminLms, { lmsLearning } from "./admin-lms.js";
import learning from "./learning.js";
import premiumExperience from "./premium-experience.js";

const id = (suffix: string) => `clms000000000000000000${suffix}`;
const ORGANIZATION = id("01"), BRANCH_A = id("02"), BRANCH_B = id("03"), COURSE_A = id("04"), COURSE_B = id("05"), BATCH_A = id("06"), BATCH_B = id("07"), BATCH_COURSE_B = id("08"), SUBJECT_A = id("09"), SUBJECT_B = id("10"), MODULE_A = id("11"), MODULE_B = id("12"), LESSON = id("13"), ATTACHMENT = id("14"), TEACHER_A = id("15"), TEACHER_B = id("16"), TEACHER_USER = id("17"), STUDENT_USER = id("18");

test("Core LMS HTTP routes enforce allocations, learner scope, branch scope and metadata protection", async t => {
  let branchAssignments = [BRANCH_A], studentBatch = BATCH_A, studentActive = true, targetStatus: LmsContentStatus = LmsContentStatus.PUBLISHED, targetCourse = COURSE_A, targetBatch = BATCH_A, targetSubject = SUBJECT_A, targetBranch = BRANCH_A, targetTeacher = TEACHER_A;
  let capturedLessonWhere: any = null, createdLesson = false, progressWrites = 0;
  const optionWheres: Record<string, any> = {};
  const allocation = { branchId: BRANCH_A, courseId: COURSE_A, batchId: BATCH_A, subjectId: SUBJECT_A };
  const fullLesson = () => ({ id: LESSON, title: "Authorized Lesson", description: "A secure Lesson", notes: "Teacher notes", position: 1, type: "VIDEO", videoUrl: null, videoName: "lesson.mp4", videoMime: "video/mp4", videoSize: 4, durationSeconds: 600, preview: false, chapter: "Motion", status: targetStatus, module: { id: MODULE_A, title: "Mechanics", position: 1 }, branch: { id: targetBranch, branchName: "Branch A" }, course: { id: COURSE_A, title: "Physics" }, batch: { id: targetBatch, name: "Batch A", code: "BA" }, subject: { id: SUBJECT_A, name: "Physics", code: "PHY" }, teacher: { id: targetTeacher, user: { name: "Teacher A" } }, homework: null, test: null, attachments: [{ id: ATTACHMENT, name: "notes.pdf", mimeType: "application/pdf", size: 4 }], progress: [] });
  const target = () => ({ id: LESSON, branchId: targetBranch, courseId: targetCourse, batchId: targetBatch, subjectId: targetSubject, teacherId: targetTeacher, status: targetStatus, durationSeconds: 600, videoData: Buffer.from("video"), videoMime: "video/mp4", videoSize: 5, videoUrl: null });
  const patches: Array<() => void> = [];
  function patch(object: any, property: string, replacement: (...args: any[]) => any) { const original = object[property]; object[property] = replacement; patches.unshift(() => { object[property] = original; }); }
  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORGANIZATION, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).branchUser, "findMany", async () => branchAssignments.map(branchId => ({ branchId })));
  patch((prisma as any).teacherProfile, "findUnique", async ({ where }: any) => where.userId === TEACHER_USER ? { id: TEACHER_A, branchId: BRANCH_A } : where.id === TEACHER_A ? { branchId: BRANCH_A } : where.id === TEACHER_B ? { branchId: BRANCH_A } : null);
  patch((prisma as any).studentProfile, "findUnique", async ({ where }: any) => where.userId === STUDENT_USER ? { batchId: studentBatch, status: studentActive ? "ACTIVE" : "INACTIVE", batch: { courseId: COURSE_A } } : null);
  patch((prisma as any).branch, "findMany", async ({ where }: any) => { optionWheres.branches = where; return [{ id: BRANCH_A, branchName: "Branch A" }]; });
  patch((prisma as any).batch, "findMany", async ({ where }: any) => { optionWheres.batches = where; return [{ id: BATCH_A, name: "Batch A", branchId: BRANCH_A, courseId: COURSE_A, course: { title: "Physics" } }]; });
  patch((prisma as any).teacherProfile, "findMany", async ({ where }: any) => { optionWheres.teachers = where; return typeof where.id === "string" ? [{ id: TEACHER_A, branchId: BRANCH_A, user: { name: "Teacher A" } }] : []; });
  patch((prisma as any).courseSubject, "findMany", async ({ where }: any) => { optionWheres.subjects = where; return [{ courseId: COURSE_A, subject: { id: SUBJECT_A, name: "Physics" } }]; });
  patch((prisma as any).module, "findMany", async ({ where }: any) => { optionWheres.modules = where; return [{ id: MODULE_A, title: "Mechanics", position: 1, courseId: COURSE_A }]; });
  patch((prisma as any).homework, "findMany", async ({ where }: any) => { optionWheres.homeworks = where; return []; });
  patch((prisma as any).test, "findMany", async ({ where }: any) => { optionWheres.tests = where; return []; });
  patch((prisma as any).studentProfile, "findMany", async ({ where }: any) => { optionWheres.students = where; return []; });
  patch((prisma as any).teacherAllocation, "findMany", async () => [allocation]);
  patch((prisma as any).teacherAllocation, "findFirst", async ({ where }: any) => where.branchId === allocation.branchId && where.courseId === allocation.courseId && where.batchId === allocation.batchId && where.teacherId === TEACHER_A && where.subjectId === allocation.subjectId ? { id: id("19") } : null);
  patch((prisma as any).courseSubject, "findUnique", async () => ({ isActive: true }));
  patch((prisma as any).teacherSubject, "findUnique", async () => ({ subjectId: SUBJECT_A }));
  patch((prisma as any).subject, "findUnique", async () => ({ status: "ACTIVE", legacyReviewStatus: "CONFIRMED" }));
  patch((prisma as any).batch, "findUnique", async ({ where }: any) => where.id === BATCH_A ? { branchId: BRANCH_A, courseId: COURSE_A, academicSessionId: id("20") } : where.id === BATCH_B ? { branchId: BRANCH_A, courseId: COURSE_A, academicSessionId: id("20") } : where.id === BATCH_COURSE_B ? { branchId: BRANCH_A, courseId: COURSE_B, academicSessionId: id("20") } : null);
  patch((prisma as any).module, "findUnique", async ({ where }: any) => ({ courseId: where.id === MODULE_B ? COURSE_B : COURSE_A }));
  patch((prisma as any).homework, "findUnique", async () => null);
  patch((prisma as any).test, "findUnique", async () => null);
  patch((prisma as any).lesson, "count", async ({ where }: any) => { capturedLessonWhere = where; return 0; });
  patch((prisma as any).lesson, "findMany", async ({ where }: any) => { capturedLessonWhere = where; return where.status === LmsContentStatus.PUBLISHED && where.batchId === studentBatch && targetStatus === LmsContentStatus.PUBLISHED && targetBatch === studentBatch ? [fullLesson()] : []; });
  patch((prisma as any).lesson, "findUnique", async ({ select }: any) => select?.videoData ? target() : select?.branchId && !select?.title ? target() : { ...fullLesson(), branchId: targetBranch, courseId: targetCourse, batchId: targetBatch, subjectId: targetSubject, teacherId: targetTeacher });
  patch((prisma as any).lesson, "create", async () => { createdLesson = true; return fullLesson(); });
  patch((prisma as any).lessonProgress, "upsert", async ({ create }: any) => { progressWrites += 1; return { id: id("21"), ...create, watchPercentage: Math.round(create.watchedSeconds / 6) }; });
  patch((prisma as any).lessonAttachment, "findUnique", async () => ({ id: ATTACHMENT, name: "notes.pdf", mimeType: "application/pdf", data: Buffer.from("file"), lesson: target() }));
  patch((prisma as any).videoTimestampBookmark, "findMany", async () => []);
  patch((prisma as any).videoTimestampBookmark, "upsert", async ({ create }: any) => ({ id: id("22"), ...create }));
  patch((prisma as any).lessonAiAsset, "findMany", async () => []);
  patch((prisma as any).lessonAiAsset, "upsert", async ({ create }: any) => create);
  patch(prisma as any, "$transaction", async (operations: any) => Array.isArray(operations) ? Promise.all(operations) : operations({}));

  const application = express(); application.use(express.json({ limit: "12mb" })); application.use("/api/v1/admin", adminLms); application.use("/api/v1/learning", learning); application.use("/api/v1/learning", lmsLearning); application.use("/api/v1", premiumExperience); application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1"); await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = (userId: string, role: Role) => jwt.sign({ userId, role, organizationId: ORGANIZATION }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  async function request(path: string, role: Role, options: { method?: string; body?: unknown; userId?: string } = {}) { const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: options.method ?? "GET", headers: { Authorization: `Bearer ${token(options.userId ?? (role === Role.STUDENT ? STUDENT_USER : role === Role.TEACHER ? TEACHER_USER : id(role.toLowerCase())), role)}`, ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }); const payload = await response.json().catch(() => null); return { status: response.status, payload }; }
  const validLesson = { title: "New Lesson", description: "Teacher-created Lesson", moduleId: MODULE_A, branchId: BRANCH_A, courseId: COURSE_A, batchId: BATCH_A, subjectId: SUBJECT_A, teacherId: TEACHER_A, chapter: "Motion", videoUrl: null, notes: "Notes", durationSeconds: 600, position: 1, preview: false, status: "DRAFT", homeworkId: null, testId: null, video: null, attachments: [] };

  try {
    await t.test("Teacher options are restricted to the active exact allocation tuple", async () => {
      const response = await request("/api/v1/admin/lms/options", Role.TEACHER);
      assert.equal(response.status, 200); assert.deepEqual(response.payload.data.allocations, [allocation]);
      assert.deepEqual(optionWheres.branches, { id: { in: [BRANCH_A] } });
      assert.deepEqual(optionWheres.batches, { id: { in: [BATCH_A] } });
      assert.deepEqual(optionWheres.teachers, { id: TEACHER_A });
      assert.deepEqual(optionWheres.modules, { courseId: { in: [COURSE_A] } });
      assert.deepEqual(optionWheres.homeworks, { OR: [allocation] });
      assert.deepEqual(optionWheres.students, { batchId: { in: [BATCH_A] } });
      const noProfile = await request("/api/v1/admin/lms/options", Role.TEACHER, { userId: id("23") });
      assert.equal(noProfile.status, 200); assert.deepEqual(optionWheres.teachers, { id: { in: [] } }); assert.deepEqual(noProfile.payload.data.allocations, []);
    });
    await t.test("Branch Admin Lesson list intersects requested and assigned branches", async () => {
      branchAssignments = [BRANCH_A]; assert.equal((await request("/api/v1/admin/lms/lessons", Role.BRANCH_ADMIN)).status, 200); assert.deepEqual(capturedLessonWhere.branchId, { in: [BRANCH_A] });
      const denied = await request(`/api/v1/admin/lms/lessons?branchId=${BRANCH_B}`, Role.BRANCH_ADMIN); assert.equal(denied.status, 403); assert.equal(denied.payload.error.code, "LMS_FORBIDDEN");
      branchAssignments = []; assert.equal((await request("/api/v1/admin/lms/lessons", Role.BRANCH_ADMIN)).status, 200); assert.deepEqual(capturedLessonWhere.branchId, { in: [] }); branchAssignments = [BRANCH_A];
    });
    await t.test("Teacher Lesson creation requires own active exact allocation and valid Module relation", async () => {
      createdLesson = false; assert.equal((await request("/api/v1/admin/lms/lessons", Role.TEACHER, { method: "POST", body: validLesson })).status, 201); assert.equal(createdLesson, true);
      for (const [change, expected] of [[{ teacherId: TEACHER_B }, 403], [{ courseId: COURSE_B, batchId: BATCH_COURSE_B, moduleId: MODULE_B }, 422], [{ batchId: BATCH_B }, 422], [{ subjectId: SUBJECT_B }, 422], [{ branchId: BRANCH_B }, 403], [{ moduleId: MODULE_B }, 422]] as const) {
        const response = await request("/api/v1/admin/lms/lessons", Role.TEACHER, { method: "POST", body: { ...validLesson, ...change } }); assert.equal(response.status, expected);
      }
    });
    await t.test("Student list and progress require active Batch and PUBLISHED Lesson", async () => {
      studentActive = true; studentBatch = BATCH_A; targetBatch = BATCH_A; targetStatus = LmsContentStatus.PUBLISHED;
      const listed = await request("/api/v1/learning/lms/me", Role.STUDENT); assert.equal(listed.status, 200); assert.equal(listed.payload.data.lessons.length, 1); assert.equal(capturedLessonWhere.batchId, BATCH_A); assert.equal(capturedLessonWhere.status, LmsContentStatus.PUBLISHED);
      progressWrites = 0; assert.equal((await request(`/api/v1/learning/lms/lessons/${LESSON}/progress`, Role.STUDENT, { method: "PATCH", body: { lastPositionSeconds: 120, timeSpentSeconds: 120 } })).status, 200); assert.equal(progressWrites, 1);
      targetBatch = BATCH_B; assert.equal((await request(`/api/v1/learning/lms/lessons/${LESSON}/progress`, Role.STUDENT, { method: "PATCH", body: { lastPositionSeconds: 1, timeSpentSeconds: 1 } })).status, 403);
      targetBatch = BATCH_A; targetStatus = LmsContentStatus.DRAFT; assert.equal((await request(`/api/v1/learning/lms/lessons/${LESSON}/progress`, Role.STUDENT, { method: "PATCH", body: { lastPositionSeconds: 1, timeSpentSeconds: 1 } })).status, 403);
      targetStatus = LmsContentStatus.ARCHIVED; assert.equal((await request(`/api/v1/learning/lms/lessons/${LESSON}/progress`, Role.STUDENT, { method: "PATCH", body: { lastPositionSeconds: 1, timeSpentSeconds: 1 } })).status, 403);
      targetStatus = LmsContentStatus.PUBLISHED; studentActive = false; assert.equal((await request("/api/v1/learning/lms/me", Role.STUDENT)).status, 403); studentActive = true;
    });
    await t.test("only the secured Core LMS progress path remains", async () => {
      for (const role of [Role.STUDENT, Role.PARENT, Role.ACCOUNTANT, Role.TEACHER]) assert.equal((await request(`/api/v1/learning/lessons/${LESSON}/progress`, role, { method: "PATCH", body: { watchedSeconds: 10 } })).status, 404);
      for (const role of [Role.PARENT, Role.ACCOUNTANT, Role.TEACHER]) assert.equal((await request(`/api/v1/learning/lms/lessons/${LESSON}/progress`, role, { method: "PATCH", body: { lastPositionSeconds: 10, timeSpentSeconds: 10 } })).status, 403);
    });
    await t.test("Premium Core Lesson metadata and bookmarks reuse canonical LMS authorization", async () => {
      targetStatus = LmsContentStatus.PUBLISHED; targetCourse = COURSE_A; targetBatch = BATCH_A; targetSubject = SUBJECT_A; targetBranch = BRANCH_A; targetTeacher = TEACHER_A; branchAssignments = [BRANCH_A];
      assert.equal((await request(`/api/v1/premium/video/${LESSON}`, Role.STUDENT)).status, 200); assert.equal((await request(`/api/v1/premium/video/${LESSON}`, Role.SUPER_ADMIN)).status, 200); assert.equal((await request(`/api/v1/premium/video/${LESSON}`, Role.TEACHER)).status, 200); assert.equal((await request(`/api/v1/premium/video/${LESSON}`, Role.BRANCH_ADMIN)).status, 200);
      for (const role of [Role.PARENT, Role.ACCOUNTANT]) assert.equal((await request(`/api/v1/premium/video/${LESSON}`, role)).status, 403);
      targetStatus = LmsContentStatus.DRAFT; assert.equal((await request(`/api/v1/premium/video/${LESSON}`, Role.STUDENT)).status, 403); targetStatus = LmsContentStatus.PUBLISHED;
      targetBatch = BATCH_B; assert.equal((await request(`/api/v1/premium/video/${LESSON}`, Role.STUDENT)).status, 403); targetBatch = BATCH_A;
      targetTeacher = TEACHER_B; assert.equal((await request(`/api/v1/premium/video/${LESSON}`, Role.TEACHER)).status, 403); targetTeacher = TEACHER_A;
      targetCourse = COURSE_B; targetBatch = BATCH_COURSE_B; assert.equal((await request(`/api/v1/premium/video/${LESSON}`, Role.TEACHER)).status, 403); assert.equal((await request(`/api/v1/admin/lms/lessons/${LESSON}/status`, Role.TEACHER, { method: "PATCH", body: { status: "ARCHIVED" } })).status, 403); targetCourse = COURSE_A; targetBatch = BATCH_A;
      targetBranch = BRANCH_B; assert.equal((await request(`/api/v1/premium/video/${LESSON}`, Role.BRANCH_ADMIN)).status, 403); targetBranch = BRANCH_A;
      assert.equal((await request(`/api/v1/premium/video/${LESSON}/bookmarks`, Role.PARENT, { method: "POST", body: { positionSeconds: 10 } })).status, 403);
      assert.equal((await request(`/api/v1/premium/video/${LESSON}/ai-assets`, Role.STUDENT, { method: "POST", body: {} })).status, 403);
    });
    await t.test("Core stored video and attachments use the same role/content policy", async () => {
      targetStatus = LmsContentStatus.PUBLISHED; targetBatch = BATCH_A; targetBranch = BRANCH_A; targetTeacher = TEACHER_A;
      assert.equal((await request(`/api/v1/learning/lms/lessons/${LESSON}/video`, Role.STUDENT)).status, 200);
      assert.equal((await request(`/api/v1/learning/lms/attachments/${ATTACHMENT}`, Role.STUDENT)).status, 200);
      assert.equal((await request(`/api/v1/learning/lms/attachments/${ATTACHMENT}`, Role.PARENT)).status, 403);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); for (const restore of patches) restore(); }
});
