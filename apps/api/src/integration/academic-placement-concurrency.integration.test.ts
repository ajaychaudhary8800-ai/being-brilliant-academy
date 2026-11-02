import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { EnquiryPriority, EnquiryStatus, Gender, Prisma, Role, StudentAcademicEnrollmentSource, StudentAcademicEnrollmentStatus, StudentAcademicTransitionType } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { runSerializableAcademicPlacement } from "../lib/academic-placement.js";
import { AppError, errorHandler } from "../lib/http.js";
import { institutionCalendarDate } from "../lib/institution-time.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import { tenantContext } from "../lib/tenant-context.js";
import adminBatches from "../routes/admin-batches.js";
import adminEnquiries from "../routes/admin-enquiries.js";
import adminStudents from "../routes/admin-students.js";
import adminTimetables from "../routes/admin-timetables.js";
import adminTeacherAllocations from "../routes/admin-teacher-allocations.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const barrier = (parties: number) => { let arrived = 0; let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; }); return () => { if (++arrived === parties) release(); return ready; }; };
const unique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const serialization = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
const foreignKey = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";

function assertSafeTarget() {
  const configured = process.env.TEST_DATABASE_URL;
  let parsed: URL | null = null;
  try { parsed = configured ? new URL(configured) : null; } catch { parsed = null; }
  const name = parsed?.pathname.replace(/^\//, "") ?? "";
  if (!enabled || !configured || process.env.DATABASE_URL !== configured || !parsed || !["postgres:", "postgresql:"].includes(parsed.protocol) || !new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname) || !/(^|[_-])(test|integration)([_-]|$)/i.test(name)) throw new Error("Refusing academic-placement integration test outside a local TEST_DATABASE_URL");
}

test("real PostgreSQL academic placement constraints, races and retry authorization remain safe", { skip: !enabled, timeout: 120_000 }, async t => {
  assertSafeTarget();
  const key = crypto.randomUUID();
  const organizationId = `academic-placement-${key}`;
  const otherOrganizationId = `academic-placement-other-${key}`;
  const createdUserIds: string[] = [];
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await systemPrisma.organization.create({ data: { id: organizationId, slug: organizationId, name: organizationId, email: `${organizationId}@example.test`, timezone: "Asia/Calcutta" } });
    await systemPrisma.organization.create({ data: { id: otherOrganizationId, slug: otherOrganizationId, name: otherOrganizationId, email: `${otherOrganizationId}@example.test` } });
    const session = (await systemPrisma.academicSession.findFirst({ where: { organizationId, isCurrent: true } }))!;
    const otherSession = (await systemPrisma.academicSession.findFirst({ where: { organizationId: otherOrganizationId, isCurrent: true } }))!;
    const branch = await systemPrisma.branch.create({ data: { organizationId, branchCode: `AP-${key}-A`, branchName: "Academic A" } });
    const branchB = await systemPrisma.branch.create({ data: { organizationId, branchCode: `AP-${key}-B`, branchName: "Academic B" } });
    const otherBranch = await systemPrisma.branch.create({ data: { organizationId: otherOrganizationId, branchCode: `AP-${key}-O`, branchName: "Other Academic" } });
    const course = await systemPrisma.course.create({ data: { organizationId, title: "Class 10", slug: `ap-${key}-course`, courseCode: `AP-${key}-COURSE`, fullDescription: "Academic placement integration", regularPricePaise: 0, branchId: branch.id } });
    const courseB = await systemPrisma.course.create({ data: { organizationId, title: "Class 11", slug: `ap-${key}-course-b`, courseCode: `AP-${key}-COURSE-B`, fullDescription: "Academic placement integration", regularPricePaise: 0, branchId: branchB.id } });
    const batch = await systemPrisma.batch.create({ data: { organizationId, name: "Section A", code: `AP-${key}-A`, branchId: branch.id, courseId: course.id, academicSession: session.name, academicSessionId: session.id, startsAt: session.startsAt, capacity: 100 } });
    const batchB = await systemPrisma.batch.create({ data: { organizationId, name: "Section B", code: `AP-${key}-B`, branchId: branchB.id, courseId: courseB.id, academicSession: session.name, academicSessionId: session.id, startsAt: session.startsAt, capacity: 100 } });
    const batchC = await systemPrisma.batch.create({ data: { organizationId, name: "Section C", code: `AP-${key}-C`, branchId: branch.id, courseId: course.id, academicSession: session.name, academicSessionId: session.id, startsAt: session.startsAt, capacity: 100 } });
    const legacyBatch = await systemPrisma.batch.create({ data: { organizationId, name: "Legacy", code: `AP-${key}-LEGACY`, branchId: branch.id, courseId: null, academicSession: session.name, academicSessionId: session.id, startsAt: session.startsAt, capacity: 100 } });
    const admin = await systemPrisma.user.create({ data: { organizationId, email: `ap-admin-${key}@example.test`, passwordHash: "integration", name: "Academic Admin", role: Role.SUPER_ADMIN } });
    createdUserIds.push(admin.id);
    const branchAdmin = await systemPrisma.user.create({ data: { organizationId, email: `ap-branch-admin-${key}@example.test`, passwordHash: "integration", name: "Branch Admin", role: Role.BRANCH_ADMIN } });
    createdUserIds.push(branchAdmin.id);
    const branchAdminB = await systemPrisma.user.create({ data: { organizationId, email: `ap-branch-admin-b-${key}@example.test`, passwordHash: "integration", name: "Branch Admin B", role: Role.BRANCH_ADMIN } });
    createdUserIds.push(branchAdminB.id);
    const otherAdmin = await systemPrisma.user.create({ data: { organizationId: otherOrganizationId, email: `ap-other-admin-${key}@example.test`, passwordHash: "integration", name: "Other Admin", role: Role.SUPER_ADMIN } });
    createdUserIds.push(otherAdmin.id);
    await systemPrisma.branchUser.create({ data: { organizationId, branchId: branch.id, userId: branchAdmin.id } });
    await systemPrisma.branchUser.create({ data: { organizationId, branchId: branchB.id, userId: branchAdminB.id } });
    const withinTenant = <T>(work: () => Promise<T>) => tenantContext.run({ organizationId, userId: admin.id, role: Role.SUPER_ADMIN }, work);
    let studentSequence = 0;
    const createProfile = async (targetBatch = batch, rollNo?: string) => {
      const suffix = `${++studentSequence}-${key}`;
      const user = await systemPrisma.user.create({ data: { organizationId, email: `ap-student-${suffix}@example.test`, passwordHash: "integration", name: `Student ${suffix}`, role: Role.STUDENT } });
      createdUserIds.push(user.id);
      return systemPrisma.studentProfile.create({ data: { organizationId, userId: user.id, admissionNo: `AP-${suffix}`, rollNo: rollNo ?? String(studentSequence), gender: Gender.OTHER, dateOfBirth: new Date("2010-01-01"), fatherName: "Parent One", motherName: "Parent Two", className: targetBatch.id === batchB.id ? courseB.title : course.title, parentMobile: "9999999999", address: "Integration address", branchId: targetBatch.branchId, batchId: targetBatch.id, academicSession: session.name, academicSessionId: session.id, admissionDate: session.startsAt } });
    };
    const activeData = (studentId: string, targetBatch = batch, rollNo = crypto.randomUUID().slice(0, 8)) => ({ organizationId, studentId, academicSessionId: session.id, branchId: targetBatch.branchId, courseId: targetBatch.courseId!, batchId: targetBatch.id, rollNo, status: StudentAcademicEnrollmentStatus.ACTIVE, source: StudentAcademicEnrollmentSource.ADMISSION, effectiveFrom: session.startsAt, effectiveTo: null, createdById: admin.id });

    const application = express();
    application.use(express.json());
    application.use("/api/v1/admin", adminStudents);
    application.use("/api/v1/admin", adminBatches);
    application.use("/api/v1/admin", adminTimetables);
    application.use("/api/v1/admin", adminTeacherAllocations);
    application.use("/api/v1/admin", adminEnquiries);
    application.use(errorHandler);
    server = application.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server!.once("listening", resolve); server!.once("error", reject); });
    const port = (server.address() as AddressInfo).port;
    const request = async (path: string, method: string, body: unknown, actor = admin, actorOrganizationId = organizationId) => {
      const token = jwt.sign({ userId: actor.id, role: actor.role, organizationId: actorOrganizationId }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, payload: text ? JSON.parse(text) : null };
    };
    let httpSequence = 0;
    const phoneBase = Number(BigInt(`0x${key.replaceAll("-", "").slice(0, 12)}`) % 8_000_000_000n) + 1_000_000_000;
    const uniqueFixtureMobile = () => `91${String(phoneBase + ++httpSequence).slice(-10).padStart(10, "1")}`;
    const studentBody = (suffix: string, overrides: Record<string, unknown> = {}) => ({ admissionNo: `HTTP-${suffix}-${key.slice(0, 8)}`, rollNo: `H-${suffix}`, name: `HTTP Student ${suffix}`, gender: Gender.OTHER, dateOfBirth: "2010-01-01", fatherName: "Parent One", motherName: "Parent Two", mobile: uniqueFixtureMobile(), parentMobile: "9999999999", email: `http-${suffix}-${key}@example.test`, password: "Student@123", address: "Integration address", branchId: branch.id, batchId: batch.id, academicSession: session.name, admissionDate: session.startsAt.toISOString().slice(0, 10), ...overrides });

    await t.test("coaching mixed-class batch retains each student's class and rejects non-member classes", async () => {
      const mixed = await systemPrisma.batch.create({ data: {
        organizationId, name: "Classes 5, 6 and 7", code: `AP-${key}-MIXED`,
        branchId: branch.id, courseId: course.id,
        academicSession: session.name, academicSessionId: session.id,
        startsAt: session.startsAt, capacity: 10, coachingGrades: [5, 6, 7],
      } });
      const enrolled: Array<{ id: string; userId: string; grade: number }> = [];
      for (const grade of [5, 6, 7]) {
        const response = await request("/students", "POST",
          studentBody(`mixed${grade}`, { batchId: mixed.id, rollNo: `MIXED-${grade}`, coachingGrade: grade }));
        assert.equal(response.status, 201, JSON.stringify(response.payload));
        assert.equal(response.payload.data.coachingGrade, grade);
        assert.equal(response.payload.data.className, `Class ${grade}`);
        assert.equal(response.payload.data.batchId, mixed.id);
        createdUserIds.push(response.payload.data.user.id);
        enrolled.push({ id: response.payload.data.id, userId: response.payload.data.user.id, grade });
      }
      assert.equal(await systemPrisma.studentProfile.count({ where: { organizationId, batchId: mixed.id } }), 3);
      const wrong = await request("/students", "POST",
        studentBody("mixed8", { batchId: mixed.id, rollNo: "MIXED-8", coachingGrade: 8 }));
      assert.equal(wrong.status, 422, JSON.stringify(wrong.payload));
      assert.equal(wrong.payload.error.code, "COACHING_GRADE_NOT_ALLOWED");
      const unspecified = await request("/students", "POST",
        studentBody("mixedmissing", { batchId: mixed.id, rollNo: "MIXED-0" }));
      assert.equal(unspecified.status, 422, JSON.stringify(unspecified.payload));
      assert.equal(unspecified.payload.error.code, "COACHING_GRADE_REQUIRED");
      const forbiddenCorrection = await request(`/students/${enrolled[0]!.id}`, "PATCH", { coachingGrade: 8 });
      assert.equal(forbiddenCorrection.status, 422, JSON.stringify(forbiddenCorrection.payload));
      const corrected = await request(`/students/${enrolled[0]!.id}`, "PATCH", { coachingGrade: 6 });
      assert.equal(corrected.status, 200, JSON.stringify(corrected.payload));
      assert.equal(corrected.payload.data.coachingGrade, 6);
      assert.equal(corrected.payload.data.className, "Class 6");
      const rest = await systemPrisma.studentProfile.findMany({
        where: { organizationId, batchId: mixed.id }, select: { coachingGrade: true },
      });
      assert.deepEqual(rest.map(s => s.coachingGrade).sort(), [6, 6, 7]);

      // Editing configured grades must not silently invalidate enrolled pupils.
      const removeSix = await request(`/batches/${mixed.id}`, "PATCH", { coachingGrades: [5, 7] });
      assert.equal(removeSix.status, 409, JSON.stringify(removeSix.payload));
      assert.equal(removeSix.payload.error.code, "COACHING_GRADE_ENROLLMENTS");
      const unchangedBatch = await systemPrisma.batch.findUniqueOrThrow({ where: { id: mixed.id } });
      assert.deepEqual(unchangedBatch.coachingGrades, [5, 6, 7]);
      const foreignRead = await request(`/batches/${mixed.id}`, "GET", undefined, otherAdmin, otherOrganizationId);
      assert.ok([403, 404].includes(foreignRead.status), JSON.stringify(foreignRead.payload));
      const foreignEdit = await request(`/batches/${mixed.id}`, "PATCH",
        { coachingGrades: [8] }, otherAdmin, otherOrganizationId);
      assert.ok([403, 404].includes(foreignEdit.status), JSON.stringify(foreignEdit.payload));

      // Unrestricted coaching batches may have no individual grade; clearing
      // the grade must also clear its stale "Class N" display label.
      const unrestricted = await request(`/batches/${mixed.id}`, "PATCH", { coachingGrades: [] });
      assert.equal(unrestricted.status, 200, JSON.stringify(unrestricted.payload));
      const cleared = await request(`/students/${enrolled[0]!.id}`, "PATCH", { coachingGrade: null });
      assert.equal(cleared.status, 200, JSON.stringify(cleared.payload));
      assert.equal(cleared.payload.data.coachingGrade, null);
      assert.equal(cleared.payload.data.className, course.title);
    });

    await t.test("coaching can assign a teacher from branch A to a group in branch B", async () => {
      const user = await systemPrisma.user.create({ data: {
        organizationId, email: `ap-cross-branch-${key}@example.test`,
        passwordHash: "integration", name: "Cross Branch Teacher", role: Role.TEACHER, isActive: true,
      } });
      const teacher = await systemPrisma.teacherProfile.create({ data: {
        organizationId, userId: user.id, employeeNo: `AP-X-${key}`, branchId: branch.id,
      } });
      let allocatedSubjectId: string | null = null;
      try {
        // School sections must retain their historical home-branch restriction;
        // this same teacher becomes cross-branch assignable only in coaching.
        await systemPrisma.organization.update({
          where: { id: organizationId }, data: { groupLabelType: "SECTION" },
        });
        const schoolDenied = await request(`/batches/${batchB.id}`, "PATCH", { teacherId: teacher.id });
        assert.equal(schoolDenied.status, 422, JSON.stringify(schoolDenied.payload));
        assert.equal(schoolDenied.payload.error.code, "INVALID_TEACHER");
        const schoolLocal = await request(`/batches/${batch.id}`, "PATCH", { teacherId: teacher.id });
        assert.equal(schoolLocal.status, 200, JSON.stringify(schoolLocal.payload));
        await systemPrisma.batch.update({ where: { id: batch.id }, data: { teacherId: null } });
        await systemPrisma.organization.update({
          where: { id: organizationId }, data: { groupLabelType: "BATCH" },
        });
        const result = await request(`/batches/${batchB.id}`, "PATCH", { teacherId: teacher.id });
        assert.equal(result.status, 200, JSON.stringify(result.payload));
        assert.equal(result.payload.data.teacher.id, teacher.id);
        assert.equal(result.payload.data.branch.id, branchB.id);
        assert.equal((await systemPrisma.batch.findUniqueOrThrow({ where: { id: batchB.id } })).teacherId, teacher.id);

        // Exercise actual subject-allocation routes, not only batch class-teacher selection.
        const allocationSubject = await systemPrisma.subject.create({ data: {
          organizationId, name: "Cross-branch allocation", code: `AP-AL-${key}`,
        } });
        allocatedSubjectId = allocationSubject.id;
        await systemPrisma.teacherSubject.create({ data: {
          organizationId, teacherId: teacher.id, subjectId: allocationSubject.id,
        } });
        await systemPrisma.courseSubject.create({ data: {
          organizationId, courseId: courseB.id, subjectId: allocationSubject.id,
        } });
        const allocationBody = {
          academicSessionId: session.id, branchId: branchB.id, courseId: courseB.id,
          batchId: batchB.id, teacherId: teacher.id, subjectId: allocationSubject.id,
          weeklyPeriods: 3, effectiveFrom: session.startsAt.toISOString().slice(0, 10),
          status: "ACTIVE",
        };
        const forbidden = await request("/teacher-allocations", "POST", allocationBody, branchAdmin);
        assert.equal(forbidden.status, 403, JSON.stringify(forbidden.payload));
        const created = await request("/teacher-allocations", "POST", allocationBody, branchAdminB);
        assert.equal(created.status, 201, JSON.stringify(created.payload));
        assert.equal(created.payload.data.organizationId, organizationId);
        assert.equal(created.payload.data.teacherId, teacher.id);
        assert.equal(created.payload.data.branchId, branchB.id);

        const crossTenantRead = await request(
          `/teacher-allocations/${created.payload.data.id}`, "GET", undefined,
          otherAdmin, otherOrganizationId,
        );
        assert.ok([403, 404].includes(crossTenantRead.status), JSON.stringify(crossTenantRead.payload));
        const crossTenantList = await request(
          `/teacher-allocations?teacherId=${teacher.id}`, "GET", undefined,
          otherAdmin, otherOrganizationId,
        );
        assert.equal(crossTenantList.status, 200, JSON.stringify(crossTenantList.payload));
        assert.equal(crossTenantList.payload.meta.total, 0);

        const activeAudit = await systemPrisma.auditLog.findFirst({ where: {
          organizationId, entity: "TeacherAllocation",
          entityId: created.payload.data.id, action: "CREATE",
        } });
        assert.ok(activeAudit, "Teacher allocation audit must belong to the authorized institution");
        const deactivated = await request(
          `/teacher-allocations/${created.payload.data.id}/deactivate`, "PATCH", {}, branchAdminB,
        );
        assert.equal(deactivated.status, 200, JSON.stringify(deactivated.payload));
        const deleted = await request(
          `/teacher-allocations/${created.payload.data.id}`, "DELETE", undefined, branchAdminB,
        );
        assert.equal(deleted.status, 204, JSON.stringify(deleted.payload));
        assert.equal(await systemPrisma.teacherAllocation.count({
          where: { organizationId, teacherId: teacher.id },
        }), 0);
      } finally {
        await systemPrisma.teacherAllocation.deleteMany({ where: { organizationId, teacherId: teacher.id } });
        await systemPrisma.teacherSubject.deleteMany({ where: { organizationId, teacherId: teacher.id } });
        if (allocatedSubjectId) {
          await systemPrisma.courseSubject.deleteMany({ where: { organizationId, subjectId: allocatedSubjectId } });
          await systemPrisma.subject.delete({ where: { id: allocatedSubjectId } });
        }
        await systemPrisma.organization.update({ where: { id: organizationId },
          data: { groupLabelType: "BATCH" } });
        await systemPrisma.batch.update({ where: { id: batch.id }, data: { teacherId: null } });
        await systemPrisma.batch.update({ where: { id: batchB.id }, data: { teacherId: null } });
        await systemPrisma.teacherProfile.delete({ where: { id: teacher.id } });
        await systemPrisma.user.delete({ where: { id: user.id } });
      }
    });


    await t.test("real HTTP coaching timetable prevents cross-branch teacher conflicts, unsafe unarchive and tenant leakage", async () => {
      const user = await systemPrisma.user.create({ data: {
        organizationId, email: `ap-timetable-teacher-${key}@example.test`,
        passwordHash: "integration", name: "Shared Coaching Teacher", role: Role.TEACHER,
      } });
      const teacher = await systemPrisma.teacherProfile.create({ data: {
        organizationId, userId: user.id, employeeNo: `AP-TT-${key}`, branchId: branch.id,
      } });
      const subject = await systemPrisma.subject.create({ data: {
        organizationId, name: "Cross-branch Physics", code: `AP-TT-${key}`,
      } });
      const roomA = await systemPrisma.classroom.create({ data: {
        organizationId, branchId: branch.id, name: "Physics A", code: `AP-A-${key}`,
      } });
      const roomB = await systemPrisma.classroom.create({ data: {
        organizationId, branchId: branchB.id, name: "Physics B", code: `AP-B-${key}`,
      } });
      await systemPrisma.courseSubject.createMany({ data: [
        { organizationId, courseId: course.id, subjectId: subject.id },
        { organizationId, courseId: courseB.id, subjectId: subject.id },
      ] });
      try {
        const period = (location: typeof branch, group: typeof batch, courseId: string, classroomId: string, startTime: string, endTime: string) => ({
          branchId: location.id, courseId, batchId: group.id, subjectId: subject.id,
          teacherId: teacher.id, classroomId, academicSession: session.name,
          day: "MONDAY", startTime, endTime, periodNumber: 1, status: "ACTIVE",
        });
        // The timetable now fails closed without an effective allocation.
        // This is a *new* negative HTTP regression, not a repeat of an
        // already accepted assignment scenario.
        await systemPrisma.teacherSubject.create({ data: {
          organizationId, teacherId: teacher.id, subjectId: subject.id,
        } });
        const withoutAllocation = await request("/timetables", "POST",
          { ...period(branch, batch, course.id, roomA.id, "11:00", "12:00"), day: "WEDNESDAY" });
        assert.equal(withoutAllocation.status, 422, JSON.stringify(withoutAllocation.payload));
        assert.equal(withoutAllocation.payload.error.code, "TEACHER_SUBJECT_NOT_ALLOCATED");

        // Explicitly establish the valid teacher-subject allocations required
        // by the strengthened single-period create/edit/reactivation policy.
        await systemPrisma.teacherAllocation.createMany({ data: [
          { organizationId, academicSessionId: session.id, branchId: branch.id,
            courseId: course.id, batchId: batch.id, teacherId: teacher.id,
            subjectId: subject.id, subjectName: subject.name, weeklyPeriods: 12,
            effectiveFrom: session.startsAt, status: "ACTIVE",
            createdById: admin.id, updatedById: admin.id },
          { organizationId, academicSessionId: session.id, branchId: branchB.id,
            courseId: courseB.id, batchId: batchB.id, teacherId: teacher.id,
            subjectId: subject.id, subjectName: subject.name, weeklyPeriods: 12,
            effectiveFrom: session.startsAt, status: "ACTIVE",
            createdById: admin.id, updatedById: admin.id },
        ] });

        // Real parallel HTTP requests must not double-book an institution-wide
        // coaching teacher even when different branches lock independently.
        const [raceA, raceB] = await Promise.all([
          request("/timetables", "POST", { ...period(branch, batch, course.id, roomA.id, "18:00", "19:00"), day: "TUESDAY" }),
          request("/timetables", "POST", { ...period(branchB, batchB, courseB.id, roomB.id, "18:30", "19:30"), day: "TUESDAY" }),
        ]);
        assert.deepEqual([raceA.status, raceB.status].sort((a, b) => a - b), [201, 409],
          JSON.stringify({ raceA, raceB }));
        const persistedRace = await systemPrisma.timetable.findMany({ where: {
          organizationId, teacherId: teacher.id, day: "TUESDAY",
          status: { not: "ARCHIVED" },
        }, select: { id: true } });
        assert.equal(persistedRace.length, 1, "Concurrent writes must leave exactly one active lesson");
        await systemPrisma.timetable.delete({ where: { id: persistedRace[0]!.id } });

        const branchBLesson = period(branchB, batchB, courseB.id, roomB.id, "15:00", "16:00");
        const first = await request("/timetables", "POST", branchBLesson);
        assert.equal(first.status, 201, JSON.stringify(first.payload));
        const firstId = first.payload.data.id as string;

        const doubleBooked = await request("/timetables", "POST",
          period(branch, batch, course.id, roomA.id, "15:30", "16:30"));
        assert.equal(doubleBooked.status, 409, JSON.stringify(doubleBooked.payload));
        assert.equal(doubleBooked.payload.error.code, "TEACHER_SCHEDULE_CONFLICT");

        const otherPeriod = await request("/timetables", "POST",
          period(branch, batch, course.id, roomA.id, "16:00", "17:00"));
        assert.equal(otherPeriod.status, 201, JSON.stringify(otherPeriod.payload));
        const secondId = otherPeriod.payload.data.id as string;

        const conflictingEdit = await request(`/timetables/${secondId}`, "PATCH",
          { startTime: "15:00", endTime: "16:00" });
        assert.equal(conflictingEdit.status, 409, JSON.stringify(conflictingEdit.payload));
        assert.equal(conflictingEdit.payload.error.code, "TEACHER_SCHEDULE_CONFLICT");

        const disallowedBranch = await request("/timetables", "POST",
          period(branchB, batchB, courseB.id, roomB.id, "17:00", "18:00"), branchAdmin);
        assert.equal(disallowedBranch.status, 403, JSON.stringify(disallowedBranch.payload));

        const otherTenantList = await request("/timetables?limit=10", "GET", undefined,
          otherAdmin, otherOrganizationId);
        assert.equal(otherTenantList.status, 200, JSON.stringify(otherTenantList.payload));
        assert.equal(otherTenantList.payload.meta.total, 0);
        const otherTenantRead = await request(`/timetables/${firstId}`, "GET", undefined,
          otherAdmin, otherOrganizationId);
        assert.ok([403, 404].includes(otherTenantRead.status), JSON.stringify(otherTenantRead.payload));
        const otherTenantEdit = await request(`/timetables/${firstId}`, "PATCH",
          { remarks: "unauthorized" }, otherAdmin, otherOrganizationId);
        assert.ok([403, 404].includes(otherTenantEdit.status), JSON.stringify(otherTenantEdit.payload));

        const archived = await request(`/timetables/${firstId}/status`, "PATCH",
          { status: "ARCHIVED" });
        assert.equal(archived.status, 200, JSON.stringify(archived.payload));
        // The legacy exact-slot uniqueness key still includes archived rows.
        // Return HTTP 409 instead of leaking a Prisma unique-constraint 500.
        const archivedSlotDuplicate = await request("/timetables", "POST", branchBLesson);
        assert.equal(archivedSlotDuplicate.status, 409, JSON.stringify(archivedSlotDuplicate.payload));
        assert.equal(archivedSlotDuplicate.payload.error.code, "TIMETABLE_SLOT_EXISTS");
        const validEdit = await request(`/timetables/${secondId}`, "PATCH",
          { startTime: "15:00", endTime: "16:00" });
        assert.equal(validEdit.status, 200, JSON.stringify(validEdit.payload));
        const unsafeRestore = await request(`/timetables/${firstId}/status`, "PATCH",
          { status: "ACTIVE" });
        assert.equal(unsafeRestore.status, 409, JSON.stringify(unsafeRestore.payload));
        assert.equal(unsafeRestore.payload.error.code, "TEACHER_SCHEDULE_CONFLICT");
        assert.equal((await systemPrisma.timetable.findUniqueOrThrow({ where: { id: firstId } })).status, "ARCHIVED");
        assert.equal(await systemPrisma.timetable.count({ where: { organizationId, teacherId: teacher.id } }), 2);
        const ownedAudit = await systemPrisma.auditLog.findMany({ where: {
          organizationId, entity: "Timetable", entityId: { in: [firstId, secondId] },
        }, select: { action: true, organizationId: true } });
        assert.ok(ownedAudit.some(event => event.action === "CREATE"), JSON.stringify(ownedAudit));
        assert.ok(ownedAudit.some(event => event.action === "UPDATE"), JSON.stringify(ownedAudit));
        assert.ok(ownedAudit.some(event => event.action === "STATUS_CHANGED"), JSON.stringify(ownedAudit));
      } finally {
        await systemPrisma.timetable.deleteMany({ where: { organizationId, teacherId: teacher.id } });
        await systemPrisma.teacherAllocation.deleteMany({ where: { organizationId, teacherId: teacher.id } });
        await systemPrisma.teacherSubject.deleteMany({ where: { organizationId, teacherId: teacher.id } });
        await systemPrisma.courseSubject.deleteMany({ where: { organizationId, subjectId: subject.id } });
        await systemPrisma.classroom.deleteMany({ where: { organizationId, id: { in: [roomA.id, roomB.id] } } });
        await systemPrisma.subject.delete({ where: { id: subject.id } });
        await systemPrisma.teacherProfile.delete({ where: { id: teacher.id } });
        await systemPrisma.auditLog.deleteMany({ where: { organizationId, entity: "Timetable" } });
        await systemPrisma.user.delete({ where: { id: user.id } });
      }
    });

    await t.test("production student routes dual-write create/import/PATCH and preserve compatible reads", async () => {
      const admitted = await request("/students", "POST", studentBody("admit"));
      assert.equal(admitted.status, 201, JSON.stringify(admitted.payload));
      assert.equal(admitted.payload.data.className, course.title);
      assert.equal(admitted.payload.data.branchId, branch.id);
      assert.equal(admitted.payload.data.academicSessionId, session.id);
      assert.equal(admitted.payload.data.currentEnrollment.source, StudentAcademicEnrollmentSource.ADMISSION);
      const studentId = admitted.payload.data.id as string;
      const userId = admitted.payload.data.user.id as string;
      createdUserIds.push(userId);
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, studentId, status: StudentAcademicEnrollmentStatus.ACTIVE } }), 1);
      const structuralBatchChange = await request(`/batches/${batch.id}`, "PATCH", { courseId: null });
      assert.equal(structuralBatchChange.status, 409);
      assert.equal(structuralBatchChange.payload.error.code, "BATCH_ACADEMIC_STRUCTURE_LOCKED");
      const nonStructuralBatchChange = await request(`/batches/${batch.id}`, "PATCH", { capacity: 101 });
      assert.equal(nonStructuralBatchChange.status, 200);

      const roll = await request(`/students/${studentId}`, "PATCH", { rollNo: "  revised-9 " });
      assert.equal(roll.status, 200, JSON.stringify(roll.payload));
      assert.equal(roll.payload.data.rollNo, "REVISED-9");
      assert.equal(roll.payload.data.currentEnrollment.rollNo, "REVISED-9");
      const same = await request(`/students/${studentId}`, "PATCH", { batchId: batch.id, branchId: branch.id, academicSession: session.name });
      assert.equal(same.status, 200, JSON.stringify(same.payload));
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, studentId } }), 1);

      const moved = await request(`/students/${studentId}`, "PATCH", { batchId: batchB.id, branchId: branchB.id, academicSession: session.name, rollNo: "B-17" });
      assert.equal(moved.status, 200, JSON.stringify(moved.payload));
      assert.equal(moved.payload.data.className, courseB.title);
      assert.equal(moved.payload.data.currentEnrollment.source, StudentAcademicEnrollmentSource.ADMIN_CHANGE);
      const historyRows = await systemPrisma.studentAcademicEnrollment.findMany({ where: { organizationId, studentId }, orderBy: { createdAt: "asc" } });
      assert.equal(historyRows.length, 2);
      assert.equal(historyRows.filter(row => row.status === StudentAcademicEnrollmentStatus.ACTIVE).length, 1);
      assert.equal(historyRows[0]!.status, StudentAcademicEnrollmentStatus.CLOSED);

      const detail = await request(`/students/${studentId}`, "GET", undefined);
      assert.equal(detail.status, 200);
      assert.equal(detail.payload.data.currentEnrollment.batchId, batchB.id);
      const history = await request(`/students/${studentId}/academic-history?page=1&limit=1`, "GET", undefined);
      assert.equal(history.status, 200);
      assert.deepEqual(history.payload.meta, { total: 2, page: 1, limit: 1, totalPages: 2 });
      assert.equal(history.payload.data[0].batchId, batchB.id);

      const civilToday = institutionCalendarDate(new Date(), "Asia/Calcutta");
      const sameDayAdmission = await request("/students", "POST", studentBody("same-day", { admissionDate: civilToday, rollNo: "SAME-DAY" }));
      assert.equal(sameDayAdmission.status, 201, JSON.stringify(sameDayAdmission.payload));
      createdUserIds.push(sameDayAdmission.payload.data.user.id);
      const sameDayMove = await request(`/students/${sameDayAdmission.payload.data.id}`, "PATCH", { batchId: batchC.id, branchId: branch.id, academicSession: session.name });
      assert.equal(sameDayMove.status, 200, JSON.stringify(sameDayMove.payload));
      const sameDayHistory = await systemPrisma.studentAcademicEnrollment.findMany({ where: { organizationId, studentId: sameDayAdmission.payload.data.id }, orderBy: { createdAt: "asc" } });
      assert.equal(sameDayHistory.length, 2);
      assert.equal(sameDayHistory[0]!.status, StudentAcademicEnrollmentStatus.CLOSED);
      assert.equal(sameDayHistory[0]!.effectiveTo!.toISOString().slice(0, 10), sameDayHistory[0]!.effectiveFrom.toISOString().slice(0, 10));
      assert.equal(sameDayHistory[1]!.status, StudentAcademicEnrollmentStatus.ACTIVE);
      assert.equal(sameDayHistory.filter(row => row.status === StudentAcademicEnrollmentStatus.ACTIVE).length, 1);
      assert.equal(sameDayHistory.filter(row => row.status === StudentAcademicEnrollmentStatus.CANCELLED).length, 0);

      const mismatched = await request("/students", "POST", studentBody("mismatch", { branchId: branchB.id }));
      assert.equal(mismatched.status, 422);
      assert.equal(mismatched.payload.error.code, "BATCH_BRANCH_MISMATCH");
      const staleSession = await request("/students", "POST", studentBody("stale-session", { academicSession: "2025-26" }));
      assert.equal(staleSession.status, 422);
      assert.equal(staleSession.payload.error.code, "BATCH_SESSION_MISMATCH");
      const courseLess = await request("/students", "POST", studentBody("course-less", { batchId: legacyBatch.id }));
      assert.equal(courseLess.status, 422);
      assert.equal(courseLess.payload.error.code, "BATCH_COURSE_REQUIRED");
      assert.equal(await systemPrisma.user.count({ where: { email: `http-course-less-${key}@example.test` } }), 0);

      const imported = await request("/students/import", "POST", { rows: [studentBody("import-ok", { rollNo: "IMP-1" }), studentBody("import-bad", { email: `http-import-bad-${key}@example.test`, branchId: branchB.id, rollNo: "IMP-2" })] });
      assert.equal(imported.status, 207, JSON.stringify(imported.payload));
      assert.equal(imported.payload.data.createdCount, 1);
      assert.equal(imported.payload.data.errorCount, 1);
      const importedProfile = await systemPrisma.studentProfile.findUnique({ where: { admissionNo: `HTTP-IMPORT-OK-${key.slice(0, 8).toUpperCase()}` } });
      assert.ok(importedProfile);
      createdUserIds.push(imported.payload.data.created[0].user.id);
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, studentId: importedProfile!.id, source: StudentAcademicEnrollmentSource.IMPORT } }), 1);
      assert.equal(await systemPrisma.user.count({ where: { email: `http-import-bad-${key}@example.test` } }), 0);

      const enquiry = await systemPrisma.enquiry.create({ data: { organizationId, enquiryNumber: `ENQ-${key}`, studentName: "Converted Student", parentName: "Converted Parent", mobile: uniqueFixtureMobile(), email: `enquiry-${key}@example.test`, branchId: branch.id, courseId: course.id, className: "Stale client class", source: "Website", priority: EnquiryPriority.MEDIUM } });
      const converted = await request(`/enquiries/${enquiry.id}/convert`, "POST", { admissionNo: `ENQ-${key.slice(0, 8)}`, rollNo: " enq-1 ", email: `converted-${key}@example.test`, password: "Student@123", batchId: batch.id, dateOfBirth: "2012-03-14", gender: "MALE", fatherName: "Converted Parent", motherName: "Converted Mother", address: "12 Test Avenue" });
      assert.equal(converted.status, 201, JSON.stringify(converted.payload));
      assert.equal(converted.payload.data.className, course.title);
      assert.equal(converted.payload.data.rollNo, "ENQ-1");
      assert.equal(converted.payload.data.gender, "MALE");
      assert.match(String(converted.payload.data.dateOfBirth), /^2012-03-14/);
      assert.equal(converted.payload.data.fatherName, "Converted Parent");
      assert.equal(converted.payload.data.motherName, "Converted Mother");
      assert.equal(converted.payload.data.address, "12 Test Avenue");
      assert.equal(converted.payload.data.currentEnrollment.source, StudentAcademicEnrollmentSource.ADMISSION);
      assert.equal(converted.payload.data.currentEnrollment.batchId, batch.id);
      createdUserIds.push(converted.payload.data.user.id);
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, studentId: converted.payload.data.id, status: StudentAcademicEnrollmentStatus.ACTIVE } }), 1);

      const conflictingEnquiry = await systemPrisma.enquiry.create({ data: { organizationId, enquiryNumber: `ENQ-CONFLICT-${key}`, studentName: "Conflicting Conversion", mobile: uniqueFixtureMobile(), branchId: branch.id, source: "Website", priority: EnquiryPriority.MEDIUM } });
      const conflictingEmail = `converted-conflict-${key}@example.test`;
      const conflictingConversion = await request(`/enquiries/${conflictingEnquiry.id}/convert`, "POST", { admissionNo: `EC-${key.slice(0, 8)}`, rollNo: "enq-1", email: conflictingEmail, password: "Student@123", batchId: batch.id, dateOfBirth: "2011-07-09", gender: "FEMALE", fatherName: "Conflict Father", motherName: "Conflict Mother", address: "45 Conflict Road" });
      assert.equal(conflictingConversion.status, 409, JSON.stringify(conflictingConversion.payload));
      assert.equal(conflictingConversion.payload.error.code, "ACADEMIC_ENROLLMENT_CONFLICT");
      assert.equal(await systemPrisma.user.count({ where: { organizationId, email: conflictingEmail } }), 0);
      assert.equal(await systemPrisma.studentProfile.count({ where: { organizationId, admissionNo: `EC-${key.slice(0, 8).toUpperCase()}` } }), 0);
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, rollNo: "ENQ-1" } }), 1);
      const unchangedEnquiry = await systemPrisma.enquiry.findUnique({ where: { id: conflictingEnquiry.id } });
      assert.equal(unchangedEnquiry!.status, EnquiryStatus.NEW);
      assert.equal(unchangedEnquiry!.convertedStudentId, null);

      const duplicateRoll = await request("/students", "POST", studentBody("duplicate-roll", { rollNo: " imp-1 " }));
      assert.equal(duplicateRoll.status, 409);
      assert.equal(duplicateRoll.payload.error.code, "ACADEMIC_ENROLLMENT_CONFLICT");
      assert.equal(await systemPrisma.user.count({ where: { email: `http-duplicate-roll-${key}@example.test` } }), 0);
      assert.equal(await systemPrisma.studentProfile.count({ where: { admissionNo: `HTTP-DUPLICATE-ROLL-${key.slice(0, 8).toUpperCase()}` } }), 0);

      const branchStudent = await request("/students", "POST", studentBody("branch-auth", { rollNo: "AUTH-1" }));
      assert.equal(branchStudent.status, 201);
      createdUserIds.push(branchStudent.payload.data.user.id);
      const forbiddenMove = await request(`/students/${branchStudent.payload.data.id}`, "PATCH", { batchId: batchB.id, branchId: branchB.id, academicSession: session.name }, branchAdmin);
      assert.equal(forbiddenMove.status, 403);
      assert.equal(forbiddenMove.payload.error.code, "BRANCH_FORBIDDEN");
      assert.equal((await systemPrisma.studentProfile.findUnique({ where: { id: branchStudent.payload.data.id } }))!.batchId, batch.id);

      const isolated = await request(`/students/${studentId}`, "GET", undefined, otherAdmin, otherOrganizationId);
      assert.equal(isolated.status, 404);
    });

    await t.test("tenant, Batch tuple, Course-null, lifecycle and creator constraints reject contradictions", async () => {
      const student = await createProfile();
      await assert.rejects(systemPrisma.studentAcademicEnrollment.create({ data: { ...activeData(student.id), branchId: branchB.id } }));
      await assert.rejects(systemPrisma.studentAcademicEnrollment.create({ data: { ...activeData(student.id), organizationId: otherOrganizationId, branchId: otherBranch.id, academicSessionId: otherSession.id, batchId: "missing", courseId: null } }));
      const legacyStudent = await createProfile(legacyBatch, "LEGACY-1");
      const legacy = await systemPrisma.studentAcademicEnrollment.create({ data: { organizationId, studentId: legacyStudent.id, academicSessionId: session.id, branchId: branch.id, courseId: null, batchId: legacyBatch.id, rollNo: "LEGACY-1", status: StudentAcademicEnrollmentStatus.ACTIVE, source: StudentAcademicEnrollmentSource.BACKFILL, effectiveFrom: session.startsAt, createdById: null } });
      assert.equal(legacy.courseId, null);
      const invalidNewStudent = await createProfile(legacyBatch, "LEGACY-2");
      await assert.rejects(systemPrisma.studentAcademicEnrollment.create({ data: { organizationId, studentId: invalidNewStudent.id, academicSessionId: session.id, branchId: branch.id, courseId: null, batchId: legacyBatch.id, rollNo: "LEGACY-2", status: StudentAcademicEnrollmentStatus.ACTIVE, source: StudentAcademicEnrollmentSource.ADMISSION, effectiveFrom: session.startsAt, createdById: admin.id } }));
      const lifecycleStudent = await createProfile(batchC, "LIFE-1");
      const sameDayClosed = await systemPrisma.studentAcademicEnrollment.create({ data: { ...activeData(lifecycleStudent.id, batchC, "LIFE-1"), status: StudentAcademicEnrollmentStatus.CLOSED, effectiveTo: session.startsAt } });
      assert.equal(sameDayClosed.status, StudentAcademicEnrollmentStatus.CLOSED);
      assert.equal(sameDayClosed.effectiveTo!.toISOString(), sameDayClosed.effectiveFrom.toISOString());
      const beforeSession = new Date(session.startsAt); beforeSession.setUTCDate(beforeSession.getUTCDate() - 1);
      await assert.rejects(systemPrisma.studentAcademicEnrollment.create({ data: { ...activeData(lifecycleStudent.id, batchC, "LIFE-PAST"), status: StudentAcademicEnrollmentStatus.CLOSED, effectiveTo: beforeSession } }));
      await assert.rejects(systemPrisma.studentAcademicEnrollment.create({ data: { ...activeData(lifecycleStudent.id, batchC, "LIFE-1"), createdById: null } }));
      const cancelled = await systemPrisma.studentAcademicEnrollment.create({ data: { ...activeData(lifecycleStudent.id, batchC, "LIFE-1"), status: StudentAcademicEnrollmentStatus.CANCELLED, effectiveTo: session.startsAt } });
      assert.equal(cancelled.status, StudentAcademicEnrollmentStatus.CANCELLED);
    });

    await t.test("same-student concurrent creation admits exactly one ACTIVE enrollment", async () => {
      const student = await createProfile(batch, "STUDENT-RACE");
      const wait = barrier(2);
      const create = (target: typeof batch) => wait().then(() => systemPrisma.studentAcademicEnrollment.create({ data: activeData(student.id, target, `R-${target.id.slice(-4)}`) }));
      const results = await Promise.allSettled([create(batch), create(batchC)]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.ok(results.some(result => result.status === "rejected" && unique(result.reason)));
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, studentId: student.id, status: StudentAcademicEnrollmentStatus.ACTIVE } }), 1);
    });

    await t.test("same-Batch normalized duplicate roll admits one winner", async () => {
      const first = await createProfile(batch, "ROLL-RACE-A");
      const second = await createProfile(batch, "ROLL-RACE-B");
      const wait = barrier(2);
      const create = (studentId: string, rollNo: string) => wait().then(() => systemPrisma.studentAcademicEnrollment.create({ data: activeData(studentId, batch, rollNo) }));
      const results = await Promise.allSettled([create(first.id, " dup-7 "), create(second.id, "DUP-7")]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.ok(results.some(result => result.status === "rejected" && unique(result.reason)));
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, batchId: batch.id, rollNo: { contains: "dup-7", mode: "insensitive" }, status: StudentAcademicEnrollmentStatus.ACTIVE } }), 1);
    });

    await t.test("simultaneous Batch changes cannot leave two ACTIVE enrollments or diverge the projection", async () => {
      const student = await createProfile(batch, "MOVE-RACE");
      await systemPrisma.studentAcademicEnrollment.create({ data: activeData(student.id, batch, "MOVE-RACE") });
      const wait = barrier(2);
      const move = (target: typeof batch | typeof batchB) => withinTenant(() => prisma.$transaction(async tx => {
        const active = await tx.studentAcademicEnrollment.findFirst({ where: { organizationId, studentId: student.id, status: StudentAcademicEnrollmentStatus.ACTIVE } });
        await wait();
        await tx.studentAcademicEnrollment.update({ where: { id: active!.id }, data: { status: StudentAcademicEnrollmentStatus.CLOSED, effectiveTo: new Date("2026-09-13") } });
        await tx.studentAcademicEnrollment.create({ data: { ...activeData(student.id, target, `MOVE-${target.id.slice(-4)}`), effectiveFrom: new Date("2026-09-13"), source: StudentAcademicEnrollmentSource.ADMIN_CHANGE } });
        await tx.studentProfile.update({ where: { id: student.id }, data: { branchId: target.branchId, batchId: target.id, academicSessionId: session.id, academicSession: session.name, className: target.id === batchB.id ? courseB.title : course.title, rollNo: `MOVE-${target.id.slice(-4)}` } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
      const results = await Promise.allSettled([move(batchB), move(batchC)]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.ok(results.some(result => result.status === "rejected" && serialization(result.reason)));
      const [activeRows, projection] = await Promise.all([systemPrisma.studentAcademicEnrollment.findMany({ where: { organizationId, studentId: student.id, status: StudentAcademicEnrollmentStatus.ACTIVE } }), systemPrisma.studentProfile.findUnique({ where: { id: student.id } })]);
      assert.equal(activeRows.length, 1);
      assert.equal(projection!.batchId, activeRows[0]!.batchId);
      assert.equal(projection!.branchId, activeRows[0]!.branchId);
      assert.equal(projection!.rollNo, activeRows[0]!.rollNo);
    });

    await t.test("promotion closes the source enrollment and records an immutable transition", async () => {
      const student = await createProfile(batch, "PROMO-18");
      await systemPrisma.studentAcademicEnrollment.create({ data: activeData(student.id, batch, "PROMO-18") });
      const moved = await request(`/students/${student.id}/academic-transitions`, "POST", { type: "PROMOTED", effectiveDate: "2027-04-01", targetBatchId: batchB.id, rollNo: "07", reason: "Completed academic year" });
      assert.equal(moved.status, 201, JSON.stringify(moved.payload));
      assert.equal(moved.payload.data.type, "PROMOTED");
      const rows = await systemPrisma.studentAcademicEnrollment.findMany({ where: { organizationId, studentId: student.id }, orderBy: { createdAt: "asc" } });
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.status, StudentAcademicEnrollmentStatus.CLOSED);
      assert.equal(rows[0]!.effectiveTo!.toISOString().slice(0, 10), "2027-04-01");
      assert.equal(rows[1]!.status, StudentAcademicEnrollmentStatus.ACTIVE);
      assert.equal(rows[1]!.batchId, batchB.id);
      assert.equal(rows[1]!.rollNo, "07");
      const transition = await systemPrisma.studentAcademicTransition.findUnique({ where: { id: moved.payload.data.id } });
      assert.equal(transition!.fromEnrollmentId, rows[0]!.id);
      assert.equal(transition!.toEnrollmentId, rows[1]!.id);
      const projection = await systemPrisma.studentProfile.findUnique({ where: { id: student.id } });
      assert.equal(projection!.batchId, batchB.id);
      const history = await request(`/students/${student.id}/academic-transitions`, "GET", undefined);
      assert.equal(history.status, 200, JSON.stringify(history.payload));
      assert.equal(history.payload.data.length, 1);
      const sourceOnlyHistory = await request(`/students/${student.id}/academic-transitions`, "GET", undefined, branchAdmin);
      assert.equal(sourceOnlyHistory.status, 200, JSON.stringify(sourceOnlyHistory.payload));
      assert.equal(sourceOnlyHistory.payload.data.length, 0);
      const destinationOnlyHistory = await request(`/students/${student.id}/academic-transitions`, "GET", undefined, branchAdminB);
      assert.equal(destinationOnlyHistory.status, 200, JSON.stringify(destinationOnlyHistory.payload));
      assert.equal(destinationOnlyHistory.payload.data.length, 0);
      await systemPrisma.branchUser.create({ data: { organizationId, branchId: branch.id, userId: branchAdminB.id } });
      const bothBranchesHistory = await request(`/students/${student.id}/academic-transitions`, "GET", undefined, branchAdminB);
      assert.equal(bothBranchesHistory.status, 200, JSON.stringify(bothBranchesHistory.payload));
      assert.equal(bothBranchesHistory.payload.data.length, 1);
    });

    await t.test("concurrent transitions from one source enrollment have one authoritative winner", async () => {
      const student = await createProfile(batch, "PROMO-RACE");
      await systemPrisma.studentAcademicEnrollment.create({ data: activeData(student.id, batch, "PROMO-RACE") });
      const results = await Promise.all([
        request(`/students/${student.id}/academic-transitions`, "POST", { type: "PROMOTED", effectiveDate: "2027-04-01", targetBatchId: batchB.id, rollNo: "RACE-B" }),
        request(`/students/${student.id}/academic-transitions`, "POST", { type: "TRANSFERRED", effectiveDate: "2027-04-01", targetBatchId: batchC.id, rollNo: "RACE-C" }),
      ]);
      assert.equal(results.filter(result => result.status === 201).length, 1);
      assert.equal(results.filter(result => result.status === 409).length, 1);
      const loser = results.find(result => result.status === 409)!;
      assert.equal(loser.payload.error.code, "ACADEMIC_TRANSITION_CONFLICT");
      const transitions = await systemPrisma.studentAcademicTransition.findMany({ where: { organizationId, studentId: student.id } });
      assert.equal(transitions.length, 1);
      const rows = await systemPrisma.studentAcademicEnrollment.findMany({ where: { organizationId, studentId: student.id }, orderBy: { createdAt: "asc" } });
      assert.equal(rows.filter(row => row.status === StudentAcademicEnrollmentStatus.CLOSED).length, 1);
      const activeRows = rows.filter(row => row.status === StudentAcademicEnrollmentStatus.ACTIVE);
      assert.equal(activeRows.length, 1);
      const winner = results.find(result => result.status === 201)!;
      assert.equal(activeRows[0]!.id, transitions[0]!.toEnrollmentId);
      assert.equal(activeRows[0]!.batchId, winner.payload.data.type === "PROMOTED" ? batchB.id : batchC.id);
      assert.equal(rows.length, 2);
      const projection = await systemPrisma.studentProfile.findUnique({ where: { id: student.id } });
      assert.equal(projection!.batchId, activeRows[0]!.batchId);
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, studentId: student.id, status: StudentAcademicEnrollmentStatus.ACTIVE } }), 1);
    });

    await t.test("transition database constraints protect type, student identity and immutability", async () => {
      const studentA = await createProfile(batch, "DB-TRANS-A");
      const studentB = await createProfile(batch, "DB-TRANS-B");
      const enrollmentA = await systemPrisma.studentAcademicEnrollment.create({ data: activeData(studentA.id, batch, "DB-TRANS-A") });
      const enrollmentB = await systemPrisma.studentAcademicEnrollment.create({ data: activeData(studentB.id, batchC, "DB-TRANS-B") });
      const destination = await systemPrisma.studentAcademicEnrollment.create({ data: { ...activeData(studentA.id, batchB, "DB-TRANS-A-DEST"), status: StudentAcademicEnrollmentStatus.CLOSED, effectiveTo: new Date("2027-04-01") } });
      const base = { organizationId, studentId: studentA.id, effectiveDate: new Date("2027-04-01"), createdById: admin.id, fromEnrollmentId: enrollmentA.id };
      await assert.rejects(systemPrisma.studentAcademicTransition.create({ data: { ...base, type: StudentAcademicTransitionType.PROMOTED, toEnrollmentId: null } }));
      await assert.rejects(systemPrisma.studentAcademicTransition.create({ data: { ...base, type: StudentAcademicTransitionType.LEFT, toEnrollmentId: destination.id } }));
      await assert.rejects(systemPrisma.studentAcademicTransition.create({ data: { ...base, type: StudentAcademicTransitionType.PROMOTED, toEnrollmentId: enrollmentA.id } }));
      await assert.rejects(systemPrisma.studentAcademicTransition.create({ data: { ...base, type: StudentAcademicTransitionType.LEFT, fromEnrollmentId: enrollmentB.id, toEnrollmentId: null } }), foreignKey);
      await assert.rejects(systemPrisma.studentAcademicTransition.create({ data: { ...base, type: StudentAcademicTransitionType.PROMOTED, toEnrollmentId: enrollmentB.id } }), foreignKey);
      const transition = await systemPrisma.studentAcademicTransition.create({ data: { ...base, type: StudentAcademicTransitionType.PROMOTED, toEnrollmentId: destination.id } });
      await assert.rejects(systemPrisma.studentAcademicTransition.update({ where: { id: transition.id }, data: { reason: "tampered" } }));
      await assert.rejects(systemPrisma.studentAcademicTransition.delete({ where: { id: transition.id } }));
    });

    await t.test("Batch capacity counts only authoritative ACTIVE enrollments", async () => {
      const capacityBatch = await systemPrisma.batch.create({ data: { organizationId, name: "Capacity Batch", code: `AP-${key}-CAPACITY`, branchId: branch.id, courseId: course.id, academicSession: session.name, academicSessionId: session.id, startsAt: session.startsAt, capacity: 1 } });
      const previous = await createProfile(capacityBatch, "CAPACITY-LEFT");
      await systemPrisma.studentAcademicEnrollment.create({ data: activeData(previous.id, capacityBatch, "CAPACITY-LEFT") });
      const left = await request(`/students/${previous.id}/academic-transitions`, "POST", { type: "LEFT", effectiveDate: "2027-04-01" });
      assert.equal(left.status, 201, JSON.stringify(left.payload));
      const mover = await createProfile(batch, "CAPACITY-MOVER");
      await systemPrisma.studentAcademicEnrollment.create({ data: activeData(mover.id, batch, "CAPACITY-MOVER") });
      const moved = await request(`/students/${mover.id}/academic-transitions`, "POST", { type: "TRANSFERRED", effectiveDate: "2027-04-01", targetBatchId: capacityBatch.id, rollNo: "CAPACITY-NEW" });
      assert.equal(moved.status, 201, JSON.stringify(moved.payload));
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, batchId: capacityBatch.id, status: StudentAcademicEnrollmentStatus.ACTIVE } }), 1);
      const blocked = await createProfile(batch, "CAPACITY-BLOCKED");
      await systemPrisma.studentAcademicEnrollment.create({ data: activeData(blocked.id, batch, "CAPACITY-BLOCKED") });
      const rejected = await request(`/students/${blocked.id}/academic-transitions`, "POST", { type: "TRANSFERRED", effectiveDate: "2027-04-01", targetBatchId: capacityBatch.id, rollNo: "CAPACITY-BLOCKED-NEW" });
      assert.equal(rejected.status, 409);
      assert.equal(rejected.payload.error.code, "BATCH_CAPACITY_REACHED");
      const leftProjection = await systemPrisma.studentProfile.findUnique({ where: { id: previous.id } });
      assert.equal(leftProjection!.batchId, capacityBatch.id);
      assert.equal(leftProjection!.status, "INACTIVE");
      assert.equal((await systemPrisma.user.findUnique({ where: { id: previous.userId } }))!.isActive, true);
    });

    await t.test("bulk transitions are ordered, independent and capacity-safe", async () => {
      const bulkTarget = await systemPrisma.batch.create({ data: { organizationId, name: "Bulk Target", code: `AP-${key}-BULK`, branchId: branch.id, courseId: course.id, academicSession: session.name, academicSessionId: session.id, startsAt: session.startsAt, capacity: 2 } });
      const students = await Promise.all(["BULK-1", "BULK-2", "BULK-3"].map(async rollNo => {
        const profile = await createProfile(batch, rollNo);
        await systemPrisma.studentAcademicEnrollment.create({ data: activeData(profile.id, batch, rollNo) });
        return profile;
      }));
      const response = await request("/students/academic-transitions/bulk", "POST", { items: students.map((student, index) => ({ studentId: student.id, type: "PROMOTED", effectiveDate: "2027-04-01", targetBatchId: bulkTarget.id, rollNo: `BULK-DEST-${index + 1}` })) });
      assert.equal(response.status, 207, JSON.stringify(response.payload));
      assert.deepEqual(response.payload.data.results.map((result: { index: number }) => result.index), [0, 1, 2]);
      assert.deepEqual(response.payload.data.results.map((result: { ok: boolean }) => result.ok), [true, true, false]);
      assert.equal(response.payload.data.results[2].error.code, "BATCH_CAPACITY_REACHED");
      assert.equal(response.payload.data.succeeded, 2);
      assert.equal(response.payload.data.failed, 1);
      assert.equal(await systemPrisma.studentAcademicTransition.count({ where: { organizationId, studentId: { in: students.map(student => student.id) } } }), 2);
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, batchId: bulkTarget.id, status: StudentAcademicEnrollmentStatus.ACTIVE } }), 2);
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, studentId: students[2]!.id, batchId: batch.id, status: StudentAcademicEnrollmentStatus.ACTIVE } }), 1);
      const projections = await systemPrisma.studentProfile.findMany({ where: { organizationId, id: { in: students.map(student => student.id) } }, select: { id: true, batchId: true }, orderBy: { admissionNo: "asc" } });
      assert.equal(projections.filter(profile => profile.batchId === bulkTarget.id).length, 2);
      assert.equal(projections.filter(profile => profile.batchId === batch.id).length, 1);
    });

    await t.test("bulk transitions enforce branch authorization per item and continue safely", async () => {
      const authTarget = await systemPrisma.batch.create({ data: { organizationId, name: "Authorized Bulk Target", code: `AP-${key}-AUTH-BULK`, branchId: branch.id, courseId: course.id, academicSession: session.name, academicSessionId: session.id, startsAt: session.startsAt, capacity: 10 } });
      const authorized = await createProfile(batch, "BULK-AUTHORIZED");
      await systemPrisma.studentAcademicEnrollment.create({ data: activeData(authorized.id, batch, "BULK-AUTHORIZED") });
      const unauthorized = await createProfile(batchB, "BULK-UNAUTHORIZED");
      await systemPrisma.studentAcademicEnrollment.create({ data: activeData(unauthorized.id, batchB, "BULK-UNAUTHORIZED") });
      const response = await request("/students/academic-transitions/bulk", "POST", { items: [
        { studentId: authorized.id, type: "TRANSFERRED", effectiveDate: "2027-04-01", targetBatchId: authTarget.id, rollNo: "BULK-AUTHORIZED-NEW" },
        { studentId: unauthorized.id, type: "TRANSFERRED", effectiveDate: "2027-04-01", targetBatchId: authTarget.id, rollNo: "BULK-UNAUTHORIZED-NEW" },
      ] }, branchAdmin);
      assert.equal(response.status, 207, JSON.stringify(response.payload));
      assert.equal(response.payload.data.results[0].ok, true);
      assert.equal(response.payload.data.results[1].ok, false);
      assert.equal(response.payload.data.results[1].error.code, "ACADEMIC_TRANSITION_FORBIDDEN");
      assert.equal(await systemPrisma.studentAcademicTransition.count({ where: { organizationId, studentId: authorized.id } }), 1);
      assert.equal(await systemPrisma.studentAcademicTransition.count({ where: { organizationId, studentId: unauthorized.id } }), 0);
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, studentId: unauthorized.id, status: StudentAcademicEnrollmentStatus.ACTIVE, batchId: batchB.id } }), 1);
    });

    await t.test("authorization revoked after a retryable attempt is re-read before retry mutation", async () => {
      const student = await createProfile(batch, "AUTH-RETRY");
      let attempts = 0;
      await assert.rejects(
        tenantContext.run({ organizationId, userId: branchAdmin.id, role: Role.BRANCH_ADMIN }, () => runSerializableAcademicPlacement(
          prisma,
          async tx => (await tx.branchUser.findMany({ where: { organizationId, userId: branchAdmin.id }, select: { branchId: true } })).map(row => row.branchId),
          async (tx, branchIds) => {
            attempts += 1;
            if (!branchIds.includes(branch.id)) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
            if (attempts === 1) {
              await systemPrisma.branchUser.delete({ where: { branchId_userId: { branchId: branch.id, userId: branchAdmin.id } } });
              await tx.studentAcademicEnrollment.create({ data: { ...activeData(student.id, batch, "AUTH-RETRY"), createdById: branchAdmin.id } });
              await tx.auditLog.create({ data: { organizationId, actorId: branchAdmin.id, action: "TEST_RETRY", entity: "StudentAcademicEnrollment", entityId: student.id } });
              throw { code: "P2034" };
            }
          },
        )),
        (error: AppError) => error.code === "BRANCH_FORBIDDEN" && error.status === 403,
      );
      assert.equal(attempts, 2);
      assert.equal(await systemPrisma.studentAcademicEnrollment.count({ where: { organizationId, studentId: student.id } }), 0);
      assert.equal(await systemPrisma.auditLog.count({ where: { organizationId, action: "TEST_RETRY" } }), 0);
      const unchanged = await systemPrisma.studentProfile.findUnique({ where: { id: student.id } });
      assert.equal(unchanged!.batchId, batch.id);
      assert.equal(unchanged!.branchId, branch.id);
      assert.equal(unchanged!.rollNo, "AUTH-RETRY");
    });
  } finally {
    assertSafeTarget();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await systemPrisma.enquiryFollowUp.deleteMany({ where: { organizationId } });
    await systemPrisma.enquiry.deleteMany({ where: { organizationId } });
    await systemPrisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "StudentAcademicTransition" DISABLE TRIGGER "StudentAcademicTransition_immutable"');
      await tx.studentAcademicTransition.deleteMany({ where: { organizationId } });
      await tx.$executeRawUnsafe('ALTER TABLE "StudentAcademicTransition" ENABLE TRIGGER "StudentAcademicTransition_immutable"');
    });
    await systemPrisma.studentAcademicEnrollment.deleteMany({ where: { organizationId } });
    await systemPrisma.auditLog.deleteMany({ where: { organizationId } });
    await systemPrisma.tenantAccessAudit.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await systemPrisma.studentProfile.deleteMany({ where: { organizationId } });
    await systemPrisma.branchUser.deleteMany({ where: { organizationId } });
    await systemPrisma.user.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await systemPrisma.batch.deleteMany({ where: { organizationId } });
    await systemPrisma.course.deleteMany({ where: { organizationId } });
    await systemPrisma.branch.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await systemPrisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
      await tx.academicSession.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
      await tx.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
    });
  }
});
