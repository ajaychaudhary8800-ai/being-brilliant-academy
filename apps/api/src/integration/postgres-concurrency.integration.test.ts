import "express-async-errors";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { AttendanceStatus, FeeStatus, Gender, Role, TeacherAllocationStatus, TimetableDay } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma, systemPrisma } from "../lib/prisma.js";
import { tenantContext } from "../lib/tenant-context.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const ORG = `phase0-${crypto.randomUUID()}`;
const email = `${ORG}@example.test`;
const isUniqueConflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const isSerializableConflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
const barrier = (parties: number) => {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return () => {
    arrived += 1;
    if (arrived === parties) release();
    return ready;
  };
};
type IntegrationFixture = {
  organizationId?: string;
  branchId?: string;
  academicSessionId?: string;
  courseId?: string;
  batchId?: string;
  subjectId?: string;
  classroomId?: string;
  adminUserId?: string;
  studentUserId?: string;
  teacherUserId?: string;
  studentProfileId?: string;
  teacherProfileId?: string;
  feeIds: string[];
};
const one = (id?: string) => id ? { id } : { id: { in: [] } };
const assertSafeIntegrationDatabaseTarget = () => {
  const configured = process.env.TEST_DATABASE_URL;
  let parsed;
  try { parsed = configured ? new URL(configured) : null; } catch { parsed = null; }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const databaseName = parsed?.pathname.replace(/^\//, "") ?? "";
  if (!enabled || !configured || process.env.DATABASE_URL !== configured || !parsed || !["postgres:", "postgresql:"].includes(parsed.protocol) || !localHosts.has(parsed.hostname) || !/(^|[_-])(test|integration)([_-]|$)/i.test(databaseName)) {
    throw new Error("Refusing trigger suspension without the opt-in local TEST_DATABASE_URL");
  }
};
const cleanupIntegrationData = async (fixture: IntegrationFixture) => {
  const organizationId = fixture.organizationId;
  if (!organizationId) return;
  const attendanceFixture = fixture.studentUserId && fixture.batchId
    ? { studentId: fixture.studentUserId, batchId: fixture.batchId }
    : { id: { in: [] } };
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["AuditLog.deleteMany", () => systemPrisma.auditLog.deleteMany({ where: { organizationId } })],
    ["TenantAccessAudit.deleteMany", () => systemPrisma.tenantAccessAudit.deleteMany({ where: { organizationId } })],
    ["Timetable.deleteMany", () => systemPrisma.timetable.deleteMany({ where: { organizationId, ...(fixture.batchId ? { batchId: fixture.batchId } : {}) } })],
    ["TeacherAllocation.deleteMany", () => systemPrisma.teacherAllocation.deleteMany({ where: { organizationId, ...(fixture.teacherProfileId ? { teacherId: fixture.teacherProfileId } : {}), ...(fixture.batchId ? { batchId: fixture.batchId } : {}), ...(fixture.academicSessionId ? { academicSessionId: fixture.academicSessionId } : {}) } })],
    ["TeacherSubject.deleteMany", () => systemPrisma.teacherSubject.deleteMany({ where: { organizationId, ...(fixture.teacherProfileId ? { teacherId: fixture.teacherProfileId } : {}), ...(fixture.subjectId ? { subjectId: fixture.subjectId } : {}) } })],
    ["CourseSubject.deleteMany", () => systemPrisma.courseSubject.deleteMany({ where: { organizationId, ...(fixture.courseId ? { courseId: fixture.courseId } : {}), ...(fixture.subjectId ? { subjectId: fixture.subjectId } : {}) } })],
    ["Attendance.deleteMany", () => systemPrisma.attendance.deleteMany({ where: attendanceFixture })],
    ["Attendance.verify", async () => {
      const count = await systemPrisma.attendance.count({ where: attendanceFixture });
      if (count) throw new Error(`Attendance fixture rows remain (${count}) for organization ${organizationId}`);
    }],
    ["FeePayment.deleteMany", () => systemPrisma.feePayment.deleteMany({ where: { feeId: { in: fixture.feeIds } } })],
    ["Fee.deleteMany", () => systemPrisma.fee.deleteMany({ where: { id: { in: fixture.feeIds } } })],
    ["StudentProfile.deleteMany", () => systemPrisma.studentProfile.deleteMany({ where: { organizationId, ...one(fixture.studentProfileId) } })],
    ["TeacherProfile.deleteMany", () => systemPrisma.teacherProfile.deleteMany({ where: { organizationId, ...one(fixture.teacherProfileId) } })],
    ["Classroom.deleteMany", () => systemPrisma.classroom.deleteMany({ where: { organizationId, ...one(fixture.classroomId) } })],
    ["Batch.deleteMany", () => systemPrisma.batch.deleteMany({ where: { organizationId, ...one(fixture.batchId) } })],
    ["Course.deleteMany", () => systemPrisma.course.deleteMany({ where: { organizationId, ...one(fixture.courseId) } })],
    ["Subject.deleteMany", () => systemPrisma.subject.deleteMany({ where: { organizationId, ...one(fixture.subjectId) } })],
    ["User.verify", async () => {
      const [attendance, payments, audits, profiles, teachers, allocations, timetables] = await Promise.all([
        systemPrisma.attendance.count({ where: attendanceFixture }),
        systemPrisma.feePayment.count({ where: { feeId: { in: fixture.feeIds } } }),
        systemPrisma.auditLog.count({ where: { organizationId } }),
        systemPrisma.studentProfile.count({ where: { organizationId, ...one(fixture.studentProfileId) } }),
        systemPrisma.teacherProfile.count({ where: { organizationId, ...one(fixture.teacherProfileId) } }),
        systemPrisma.teacherAllocation.count({ where: { organizationId, ...(fixture.teacherProfileId ? { teacherId: fixture.teacherProfileId } : {}), ...(fixture.batchId ? { batchId: fixture.batchId } : {}) } }),
        systemPrisma.timetable.count({ where: { organizationId, ...(fixture.batchId ? { batchId: fixture.batchId } : {}) } }),
      ]);
      const remaining = { attendance, payments, audits, profiles, teachers, allocations, timetables };
      if (Object.values(remaining).some(Boolean)) throw new Error(`User fixture dependencies remain for organization ${organizationId}: ${JSON.stringify(remaining)}`);
    }],
    ["User.deleteMany", () => systemPrisma.user.deleteMany({ where: { organizationId, id: { in: [fixture.adminUserId, fixture.studentUserId, fixture.teacherUserId].filter((id): id is string => Boolean(id)) } } })],
    ["Branch.deleteMany", () => systemPrisma.branch.deleteMany({ where: { organizationId, ...one(fixture.branchId) } })],
    ["Organization.verify", async () => {
      const [audits, accessAudits, attendance, timetable, allocations, teacherSubjects, courseSubjects, payments, fees, students, teachers, classrooms, courses, subjects, users, batches, branches] = await Promise.all([
        systemPrisma.auditLog.count({ where: { organizationId } }),
        systemPrisma.tenantAccessAudit.count({ where: { organizationId } }),
        systemPrisma.attendance.count({ where: attendanceFixture }),
        systemPrisma.timetable.count({ where: { organizationId } }),
        systemPrisma.teacherAllocation.count({ where: { organizationId } }),
        systemPrisma.teacherSubject.count({ where: { organizationId } }),
        systemPrisma.courseSubject.count({ where: { organizationId } }),
        systemPrisma.feePayment.count({ where: { feeId: { in: fixture.feeIds } } }),
        systemPrisma.fee.count({ where: { id: { in: fixture.feeIds } } }),
        systemPrisma.studentProfile.count({ where: { organizationId } }),
        systemPrisma.teacherProfile.count({ where: { organizationId } }),
        systemPrisma.classroom.count({ where: { organizationId } }),
        systemPrisma.course.count({ where: { organizationId } }),
        systemPrisma.subject.count({ where: { organizationId } }),
        systemPrisma.user.count({ where: { organizationId } }),
        systemPrisma.batch.count({ where: { organizationId } }),
        systemPrisma.branch.count({ where: { organizationId } }),
      ]);
      const remaining = { audits, accessAudits, attendance, timetable, allocations, teacherSubjects, courseSubjects, payments, fees, students, teachers, classrooms, courses, subjects, users, batches, branches };
      if (Object.values(remaining).some(Boolean)) throw new Error(`Fixture rows remain before organization deletion ${organizationId}: ${JSON.stringify(remaining)}`);
    }],
    ["AcademicSessionAndOrganization.delete", async () => {
      assertSafeIntegrationDatabaseTarget();
      await systemPrisma.$transaction(async tx => {
        // PostgreSQL transactional DDL restores the trigger state automatically if any delete or assertion throws.
        await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
        const sessionCountBeforeDelete = await tx.academicSession.count({ where: { organizationId } });
        const sessionDelete = await tx.academicSession.deleteMany({ where: { organizationId } });
        if (sessionDelete.count !== sessionCountBeforeDelete) throw new Error(`AcademicSession cleanup count mismatch for organization ${organizationId}: expected ${sessionCountBeforeDelete}, deleted ${sessionDelete.count}`);
        const sessions = await tx.academicSession.count({ where: { organizationId } });
        if (sessions) throw new Error(`AcademicSession fixture rows remain (${sessions}) for organization ${organizationId}`);
        const organizationDelete = await tx.organization.deleteMany({ where: { id: organizationId } });
        if (organizationDelete.count !== 1) throw new Error(`Expected to delete exactly one Organization ${organizationId}; deleted ${organizationDelete.count}`);
        await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
      });
    }],
  ];
  const failures: unknown[] = [];
  for (const [label, step] of steps) {
    try { await step(); } catch (error) {
      failures.push(new Error(`${label} failed for organization ${organizationId}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
    }
  }
  if (failures.length) throw new AggregateError(failures, `Integration fixture cleanup failed for organization ${organizationId}`);
};

test("real PostgreSQL concurrency contracts", { skip: !enabled, timeout: 60_000 }, async t => {
  const branchCode = `${ORG}-branch`;
  let sessionName = "";
  const batchCode = `${ORG}-batch`;
  const courseCode = `${ORG}-course`;
  const subjectCode = `${ORG}-subject`;
  let organization: any;
  let branch: any;
  let session: any;
  let batch: any;
  let student: any;
  let admin: any;
  let teacher: any;
  let course: any;
  let subject: any;
  let classroom: any;
  const fixture: IntegrationFixture = { feeIds: [] };
  try {
    organization = await systemPrisma.organization.create({ data: { id: ORG, slug: ORG, name: ORG, email } });
    fixture.organizationId = organization.id;
    branch = await systemPrisma.branch.create({ data: { organizationId: ORG, branchCode, branchName: "Phase 0 Branch" } });
    fixture.branchId = branch.id;
    const provisionedSessions = await systemPrisma.academicSession.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, isCurrent: true } });
    const currentSessions = provisionedSessions.filter(item => item.isCurrent);
    assert.equal(provisionedSessions.length, 1, `Expected exactly one bootstrapped AcademicSession for ${ORG}; found ${provisionedSessions.length}`);
    assert.equal(currentSessions.length, 1, `Expected exactly one current bootstrapped AcademicSession for ${ORG}; found ${currentSessions.length}`);
    session = currentSessions[0]!;
    sessionName = session.name;
    fixture.academicSessionId = session.id;
    batch = await systemPrisma.batch.create({ data: { organizationId: ORG, name: "Phase 0 Batch", code: batchCode, branchId: branch.id, academicSessionId: session.id, startsAt: new Date("2026-04-01") } });
    fixture.batchId = batch.id;
    admin = await systemPrisma.user.create({ data: { organizationId: ORG, email: `${ORG}-admin@example.test`, passwordHash: "integration", name: "Phase 0 Admin", role: Role.SUPER_ADMIN } });
    fixture.adminUserId = admin.id;
    const withinTenant = <T>(operation: () => Promise<T>) => tenantContext.run({ organizationId: ORG, userId: admin.id, role: Role.SUPER_ADMIN }, operation);
    const studentUser = await systemPrisma.user.create({ data: { organizationId: ORG, email: `${ORG}-student@example.test`, passwordHash: "integration", name: "Phase 0 Student", role: Role.STUDENT } });
    fixture.studentUserId = studentUser.id;
    student = await systemPrisma.studentProfile.create({ data: { organizationId: ORG, userId: studentUser.id, admissionNo: `${ORG}-admission`, rollNo: "1", gender: Gender.OTHER, dateOfBirth: new Date("2010-01-01"), fatherName: "Parent", motherName: "Parent", className: "CLASS_10", parentMobile: "9999999999", address: "Test", branchId: branch.id, batchId: batch.id, academicSession: sessionName, academicSessionId: session.id, admissionDate: new Date("2026-04-01") } });
    fixture.studentProfileId = student.id;
    const teacherUser = await systemPrisma.user.create({ data: { organizationId: ORG, email: `${ORG}-teacher@example.test`, passwordHash: "integration", name: "Phase 0 Teacher", role: Role.TEACHER } });
    fixture.teacherUserId = teacherUser.id;
    teacher = await systemPrisma.teacherProfile.create({ data: { organizationId: ORG, userId: teacherUser.id, employeeNo: `${ORG}-teacher`, branchId: branch.id } });
    fixture.teacherProfileId = teacher.id;
    course = await systemPrisma.course.create({ data: { organizationId: ORG, title: "Phase 0 Course", slug: `${ORG}-course`, courseCode, fullDescription: "Integration", regularPricePaise: 0, branchId: branch.id } });
    fixture.courseId = course.id;
    subject = await systemPrisma.subject.create({ data: { organizationId: ORG, name: "Phase 0 Subject", code: subjectCode } });
    fixture.subjectId = subject.id;
    await systemPrisma.courseSubject.create({ data: { organizationId: ORG, courseId: course.id, subjectId: subject.id } });
    await systemPrisma.teacherSubject.create({ data: { organizationId: ORG, teacherId: teacher.id, subjectId: subject.id } });
    classroom = await systemPrisma.classroom.create({ data: { organizationId: ORG, name: "Phase 0 Room", code: `${ORG}-room`, branchId: branch.id } });
    fixture.classroomId = classroom.id;

    await t.test("two simultaneous payments cannot over-collect the remaining balance", async () => {
      const fee = await systemPrisma.fee.create({ data: { organizationId: ORG, studentId: student.id, branchId: branch.id, batchId: batch.id, feeHead: "Concurrency", totalPaise: 1_000, dueDate: new Date("2027-03-31") } });
      fixture.feeIds.push(fee.id);
      const waitForRace = barrier(2);
      const pay = () => waitForRace().then(() => withinTenant(() => prisma.$transaction(async tx => {
        const current = await tx.fee.findUnique({ where: { id: fee.id }, select: { id: true, totalPaise: true, discountPaise: true, finePaise: true, dueDate: true, branchId: true } });
        const paid = await tx.feePayment.aggregate({ where: { feeId: fee.id }, _sum: { amountPaise: true } });
        const previous = paid._sum.amountPaise ?? 0;
        if (previous + 1_000 > current!.totalPaise - current!.discountPaise + current!.finePaise) throw new Error("OVER_COLLECTION");
        const payment = await tx.feePayment.create({ data: { feeId: fee.id, amountPaise: 1_000, paymentMode: "CASH", receiptNumber: `${ORG}-${crypto.randomUUID()}`, collectedById: admin.id } });
        await tx.fee.update({ where: { id: fee.id }, data: { amountPaidPaise: previous + payment.amountPaise, status: FeeStatus.PAID } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "PAYMENT_CREATED", entity: "FeePayment", entityId: payment.id, metadata: { feeId: fee.id, amountPaise: payment.amountPaise } } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })));
      const results = await Promise.allSettled([pay(), pay()]);
      const [payments, finalFee, audits] = await Promise.all([
        systemPrisma.feePayment.count({ where: { feeId: fee.id } }),
        systemPrisma.fee.findUnique({ where: { id: fee.id }, select: { amountPaidPaise: true, status: true } }),
        systemPrisma.auditLog.count({ where: { organizationId: ORG, entity: "FeePayment" } }),
      ]);
      assert.equal(payments, 1);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.deepEqual(finalFee, { amountPaidPaise: 1_000, status: FeeStatus.PAID });
      assert.equal(audits, 1);
    });

    await t.test("partial payments remain mathematically bounded under concurrency", async () => {
      const fee = await systemPrisma.fee.create({ data: { organizationId: ORG, studentId: student.id, branchId: branch.id, batchId: batch.id, feeHead: "Partial concurrency", totalPaise: 1_000, dueDate: new Date("2027-03-31") } });
      fixture.feeIds.push(fee.id);
      const waitForRace = barrier(2);
      const collect = () => waitForRace().then(() => withinTenant(() => prisma.$transaction(async tx => {
        const current = await tx.fee.findUnique({ where: { id: fee.id }, select: { totalPaise: true, discountPaise: true, finePaise: true } });
        const paid = await tx.feePayment.aggregate({ where: { feeId: fee.id }, _sum: { amountPaise: true } });
        const previous = paid._sum.amountPaise ?? 0;
        if (previous + 400 > current!.totalPaise - current!.discountPaise + current!.finePaise) throw new Error("OVER_COLLECTION");
        await tx.feePayment.create({ data: { feeId: fee.id, amountPaise: 400, paymentMode: "CASH", receiptNumber: `${ORG}-${crypto.randomUUID()}`, collectedById: admin.id } });
        const amountPaidPaise = previous + 400;
        await tx.fee.update({ where: { id: fee.id }, data: { amountPaidPaise, status: amountPaidPaise === 1_000 ? FeeStatus.PAID : FeeStatus.PARTIAL } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })));
      const results = await Promise.allSettled([collect(), collect()]);
      const [payments, finalFee] = await Promise.all([
        systemPrisma.feePayment.aggregate({ where: { feeId: fee.id }, _sum: { amountPaise: true } }),
        systemPrisma.fee.findUnique({ where: { id: fee.id }, select: { amountPaidPaise: true, totalPaise: true, status: true } }),
      ]);
      const amountPaid = payments._sum.amountPaise ?? 0;
      assert.ok(results.every(result => result.status === "fulfilled" || result.status === "rejected" && isSerializableConflict(result.reason)));
      assert.ok(amountPaid <= 1_000);
      assert.equal(finalFee?.amountPaidPaise, amountPaid);
      assert.equal(finalFee?.status, amountPaid === 1_000 ? FeeStatus.PAID : FeeStatus.PARTIAL);
    });

    await t.test("duplicate external transaction identifiers admit one payment", async () => {
      const fee = await systemPrisma.fee.create({ data: { organizationId: ORG, studentId: student.id, branchId: branch.id, batchId: batch.id, feeHead: "Identifier race", totalPaise: 1_000, dueDate: new Date("2027-03-31") } });
      fixture.feeIds.push(fee.id);
      const waitForRace = barrier(2);
      const collect = () => waitForRace().then(() => withinTenant(() => prisma.$transaction(tx => tx.feePayment.create({ data: { feeId: fee.id, amountPaise: 500, paymentMode: "ONLINE", transactionId: `${ORG}-external-race`, receiptNumber: `${ORG}-${crypto.randomUUID()}`, collectedById: admin.id } }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })));
      const results = await Promise.allSettled([collect(), collect()]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.ok(results.some(result => result.status === "rejected" && isUniqueConflict(result.reason)));
      assert.equal(await systemPrisma.feePayment.count({ where: { feeId: fee.id, transactionId: `${ORG}-external-race` } }), 1);
    });

    await t.test("attendance uniqueness rejects simultaneous duplicate authoritative rows", async () => {
      const date = new Date("2026-06-15");
      const waitForRace = barrier(2);
      const create = () => waitForRace().then(() => withinTenant(() => prisma.attendance.create({ data: { studentId: student.userId, batchId: batch.id, date, status: AttendanceStatus.PRESENT } })));
      const results = await Promise.allSettled([create(), create()]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.ok(results.some(result => result.status === "rejected" && isUniqueConflict(result.reason)));
    });

    await t.test("timetable uniqueness rejects simultaneous conflicting writes", async () => {
      const row = { organizationId: ORG, branchId: branch.id, courseId: course.id, batchId: batch.id, subjectId: subject.id, teacherId: teacher.id, classroomId: classroom.id, day: TimetableDay.MONDAY, startMinute: 600, endMinute: 660, periodNumber: 1, academicSession: sessionName, academicSessionId: session.id };
      const waitForRace = barrier(2);
      const create = () => waitForRace().then(() => withinTenant(() => prisma.timetable.create({ data: row })));
      const results = await Promise.allSettled([create(), create()]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.ok(results.some(result => result.status === "rejected" && isUniqueConflict(result.reason)));
    });

    await t.test("exact duplicate teacher allocations are database protected", async () => {
      const row = { organizationId: ORG, branchId: branch.id, academicSessionId: session.id, courseId: course.id, batchId: batch.id, teacherId: teacher.id, subjectId: subject.id, subjectName: subject.name, weeklyPeriods: 2, effectiveFrom: new Date("2026-04-01"), effectiveTo: null, status: TeacherAllocationStatus.ACTIVE, createdById: admin.id, updatedById: admin.id };
      const waitForRace = barrier(2);
      const create = () => waitForRace().then(() => withinTenant(() => prisma.teacherAllocation.create({ data: row })));
      const results = await Promise.allSettled([create(), create()]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.ok(results.some(result => result.status === "rejected" && isUniqueConflict(result.reason)));
      assert.equal(await systemPrisma.teacherAllocation.count({ where: { organizationId: ORG, teacherId: teacher.id, batchId: batch.id, subjectId: subject.id, status: TeacherAllocationStatus.ACTIVE } }), 1);
    });
  } finally {
    await cleanupIntegrationData(fixture);
  }
});
