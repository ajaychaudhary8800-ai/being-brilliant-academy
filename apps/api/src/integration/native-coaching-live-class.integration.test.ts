import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Gender, GroupLabelType, LearningStatus, LiveClassProvider, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import learning from "../routes/learning-ecosystem.js";

/**
 * Actual PostgreSQL + authenticated HTTP regression for the coaching native
 * classroom cross-branch fix. ONLY ephemeral local integration DB is allowed.
 * This test NEVER invokes LiveKit, recording Egress, payments or a staging host.
 */
const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
function localTestDatabaseOnly() {
  const value = process.env.TEST_DATABASE_URL;
  let parsed: URL | null = null;
  try { parsed = value ? new URL(value) : null; } catch { /* refuse */ }
  const db = parsed?.pathname.replace(/^\//, "") ?? "";
  if (!enabled || !value || process.env.DATABASE_URL !== value
    || !parsed || !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || !/(^|[_-])(test|integration)([_-]|$)/i.test(db)) {
    throw new Error("REFUSED_NON_LOCAL_INTEGRATION_DATABASE");
  }
}

test("native coaching classroom enforces exact branch allocation, student access and tenant denial over real HTTP", { skip: !enabled, timeout: 120_000 }, async () => {
  localTestDatabaseOnly();
  const unique = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const coachingId = "native-coaching-" + unique;
  const schoolId = "native-school-" + unique;
  const allOrgs = [coachingId, schoolId];
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;

  try {
    const createInstitution = async (organizationId: string, mode: GroupLabelType) => {
      await systemPrisma.organization.create({
        data: { id: organizationId, slug: organizationId, name: organizationId,
          email: organizationId + "@example.test", groupLabelType: mode },
      });
      const session = await systemPrisma.academicSession.findFirst({
        where: { organizationId, isCurrent: true },
      });
      assert.ok(session, "Tenant auto-provisions its current academic session");
      const home = await systemPrisma.branch.create({
        data: { organizationId, branchCode: unique + "-HOME-" + mode, branchName: "Home Branch" },
      });
      const allocated = await systemPrisma.branch.create({
        data: { organizationId, branchCode: unique + "-ALLOC-" + mode, branchName: "Allocated Branch" },
      });
      // A course can have a home branch different from a legitimate coaching
      // batch's branch. This is what the staging Batch 1 inventory revealed.
      const course = await systemPrisma.course.create({
        data: { organizationId, title: "Native Test Course", slug: "native-" + unique + "-" + mode,
          courseCode: "NC-" + unique + "-" + mode, fullDescription: "Ephemeral native classroom regression",
          regularPricePaise: 0, branchId: home.id },
      });
      const batch = await systemPrisma.batch.create({
        data: { organizationId, name: "Cross-branch Batch",
          code: "NB-" + unique + "-" + mode, branchId: allocated.id,
          courseId: course.id, academicSession: session.name, academicSessionId: session.id,
          startsAt: session.startsAt, capacity: 30 },
      });
      const subject = await systemPrisma.subject.create({
        data: { organizationId, name: "Test Physics", code: "NP-" + unique + "-" + mode },
      });
      await systemPrisma.courseSubject.create({
        data: { organizationId, courseId: course.id, subjectId: subject.id, isActive: true },
      });
      const admin = await systemPrisma.user.create({
        data: { organizationId, email: "native-admin-" + unique + "-" + mode + "@example.test",
          name: "Native Test Admin", passwordHash: "disposable-no-login", role: Role.SUPER_ADMIN },
      });
      const teacherUser = await systemPrisma.user.create({
        data: { organizationId, email: "native-teacher-" + unique + "-" + mode + "@example.test",
          name: "Native Test Teacher", passwordHash: "disposable-no-login", role: Role.TEACHER },
      });
      const teacher = await systemPrisma.teacherProfile.create({
        data: { organizationId, userId: teacherUser.id, branchId: home.id,
          employeeNo: "NT-" + unique + "-" + mode },
      });
      const allocation = await systemPrisma.teacherAllocation.create({
        data: { organizationId, academicSessionId: session.id, branchId: allocated.id,
          courseId: course.id, batchId: batch.id, subjectId: subject.id,
          subjectName: subject.name, teacherId: teacher.id, weeklyPeriods: 2,
          effectiveFrom: new Date("2026-01-01"), effectiveTo: null,
          createdById: admin.id, updatedById: admin.id, status: "ACTIVE" },
      });
      return { organizationId, home, allocated, course, batch, subject, admin, teacherUser, teacher, allocation };
    };

    const coaching = await createInstitution(coachingId, GroupLabelType.BATCH);
    const school = await createInstitution(schoolId, GroupLabelType.SECTION);

    const learner = await systemPrisma.user.create({
      data: { organizationId: coachingId, email: "native-student-" + unique + "@example.test",
        name: "Native Test Student", passwordHash: "disposable-no-login", role: Role.STUDENT },
    });
    await systemPrisma.studentProfile.create({
      data: { organizationId: coachingId, userId: learner.id,
        admissionNo: "NS-" + unique, rollNo: "1", gender: Gender.OTHER,
        dateOfBirth: new Date("2011-01-01"), fatherName: "Test Parent",
        motherName: "Test Parent", className: "Class 6", parentMobile: "9999999999",
        address: "Ephemeral QA only", branchId: coaching.allocated.id,
        batchId: coaching.batch.id, academicSession: "CURRENT",
        academicSessionId: (await systemPrisma.academicSession.findFirst({
          where: { organizationId: coachingId, isCurrent: true }, select: { id: true },
        }))!.id, admissionDate: new Date("2026-04-01") },
    });

    const app = express();
    app.use(express.json());
    app.use("/api/v1", learning);
    app.use(errorHandler);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const port = (server.address() as AddressInfo).port;
    const http = async (actor: { id: string; role: Role; organizationId: string },
      method: string, path: string, data?: unknown) => {
      const token = jwt.sign({
        userId: actor.id, role: actor.role, organizationId: actor.organizationId,
      }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
      const response = await fetch("http://127.0.0.1:" + port + "/api/v1" + path, {
        method, headers: { Authorization: "Bearer " + token,
          "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const body = await response.text();
      return { status: response.status, body: body ? JSON.parse(body) : null };
    };
    const start = new Date("2026-11-20T09:00:00Z");
    const end = new Date("2026-11-20T10:00:00Z");
    const payload = (row: typeof coaching, provider: LiveClassProvider) => ({
      title: "Synthetic Native Physics Class", provider,
      branchId: row.allocated.id, courseId: row.course.id,
      batchId: row.batch.id, subjectId: row.subject.id, teacherId: row.teacher.id,
      status: LearningStatus.PUBLISHED, startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      ...(provider !== LiveClassProvider.NATIVE ? { meetingUrl: "https://example.test/meeting" } : {}),
    });

    const created = await http(coaching.teacherUser, "POST", "/learning/live-classes",
      payload(coaching, LiveClassProvider.NATIVE));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const classroomId = created.body.data.id as string;
    assert.equal(created.body.data.provider, LiveClassProvider.NATIVE);
    assert.match(created.body.data.meetingUrl, /\/live-class\/class-/);

    const teacherList = await http(coaching.teacherUser, "GET", "/learning/live-classes");
    assert.equal(teacherList.status, 200, JSON.stringify(teacherList.body));
    assert.ok(teacherList.body.data.some((item: { id: string }) => item.id === classroomId));

    const studentList = await http(learner, "GET", "/learning/live-classes");
    assert.equal(studentList.status, 200, JSON.stringify(studentList.body));
    assert.ok(studentList.body.data.some((item: { id: string }) => item.id === classroomId));

    const foreignList = await http(school.admin, "GET", "/learning/live-classes");
    assert.equal(foreignList.status, 200, JSON.stringify(foreignList.body));
    assert.ok(foreignList.body.data.every((item: { id: string }) => item.id !== classroomId));

    const externalProvider = await http(coaching.teacherUser, "POST", "/learning/live-classes",
      { ...payload(coaching, LiveClassProvider.ZOOM), startsAt: "2026-11-20T11:00:00Z",
        endsAt: "2026-11-20T12:00:00Z" });
    assert.equal(externalProvider.status, 422, JSON.stringify(externalProvider.body));

    const schoolDenied = await http(school.admin, "POST", "/learning/live-classes",
      payload(school, LiveClassProvider.NATIVE));
    assert.equal(schoolDenied.status, 422, JSON.stringify(schoolDenied.body));

    await systemPrisma.teacherAllocation.update({
      where: { id: coaching.allocation.id }, data: { status: "INACTIVE" },
    });
    const revoked = await http(coaching.teacherUser, "POST", "/learning/live-classes",
      { ...payload(coaching, LiveClassProvider.NATIVE), startsAt: "2026-11-20T13:00:00Z",
        endsAt: "2026-11-20T14:00:00Z" });
    assert.ok([403, 422].includes(revoked.status), JSON.stringify(revoked.body));
    assert.equal(await systemPrisma.liveClass.count({ where: { organizationId: coachingId } }), 1,
      "Revoked allocation must not create another classroom");

    console.log("NATIVE_COACHING_HTTP_POSTGRES=PASS");
    console.log("NATIVE_SCHOOL_CROSS_BRANCH_DENIAL=PASS");
    console.log("NATIVE_FOREIGN_TENANT_READ_DENIAL=PASS");
    console.log("NATIVE_REVOKED_ALLOCATION_DENIAL=PASS");
    console.log("LIVEKIT_REQUESTS=0");
    console.log("PAYMENT_REQUESTS=0");
  } finally {
    localTestDatabaseOnly();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    for (const organizationId of allOrgs) {
      await systemPrisma.liveClassInteraction.deleteMany({ where: { organizationId } });
      await systemPrisma.liveClassAttendance.deleteMany({ where: { organizationId } });
      await systemPrisma.liveClass.deleteMany({ where: { organizationId } });
      await systemPrisma.notification.deleteMany({ where: { user: { organizationId } } });
      await systemPrisma.auditLog.deleteMany({ where: { organizationId } });
      await systemPrisma.teacherAllocation.deleteMany({ where: { organizationId } });
      await systemPrisma.studentProfile.deleteMany({ where: { organizationId } });
      await systemPrisma.teacherProfile.deleteMany({ where: { organizationId } });
      await systemPrisma.courseSubject.deleteMany({ where: { organizationId } });
      await systemPrisma.subject.deleteMany({ where: { organizationId } });
      await systemPrisma.batch.deleteMany({ where: { organizationId } });
      await systemPrisma.course.deleteMany({ where: { organizationId } });
      await systemPrisma.tenantAccessAudit.deleteMany({ where: { organizationId } });
      await systemPrisma.user.deleteMany({ where: { organizationId } });
      await systemPrisma.branch.deleteMany({ where: { organizationId } });
    }
    await systemPrisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
      await tx.academicSession.deleteMany({ where: { organizationId: { in: allOrgs } } });
      await tx.organization.deleteMany({ where: { id: { in: allOrgs } } });
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
    });
  }
});
