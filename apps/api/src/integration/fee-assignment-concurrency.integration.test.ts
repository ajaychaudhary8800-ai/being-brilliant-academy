import "express-async-errors";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { FeePlanStatus, Gender, Prisma, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import feeAssignments from "../routes/fee-assignments.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const known = (error: unknown, code: string) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
const lineageViolation = (error: unknown) => error instanceof Error && String(error).includes("Fee generated sources must belong to the same FeePlan");

function assertSafeTarget() {
  const configured = process.env.TEST_DATABASE_URL;
  let parsed: URL | null = null;
  try { parsed = configured ? new URL(configured) : null; } catch { parsed = null; }
  const name = parsed?.pathname.replace(/^\//, "") ?? "";
  if (!configured || process.env.DATABASE_URL !== configured || !parsed || !["postgres:", "postgresql:"].includes(parsed.protocol) || !new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname) || !/(^|[_-])(test|integration)([_-]|$)/i.test(name)) throw new Error("Refusing fee-assignment integration test outside a local TEST_DATABASE_URL");
}

test("real PostgreSQL keeps fee assignment generation and source constraints authoritative", { skip: !enabled, timeout: 90_000 }, async () => {
  assertSafeTarget();
  const token = crypto.randomUUID();
  const organizationId = `fee-assignment-${token}`;
  const otherOrganizationId = `fee-assignment-other-${token}`;
  let server: Server | undefined;
  try {
    await systemPrisma.organization.create({ data: { id: organizationId, slug: organizationId, name: organizationId, email: `${organizationId}@example.test` } });
    await systemPrisma.organization.create({ data: { id: otherOrganizationId, slug: otherOrganizationId, name: otherOrganizationId, email: `${otherOrganizationId}@example.test` } });
    const session = (await systemPrisma.academicSession.findMany({ where: { organizationId, isCurrent: true } }))[0]!;
    const otherSession = (await systemPrisma.academicSession.findMany({ where: { organizationId: otherOrganizationId, isCurrent: true } }))[0]!;
    assert.ok(session); assert.ok(otherSession);
    const alternateSession = await systemPrisma.academicSession.create({
      data: {
        organizationId,
        name: `Snapshot mismatch ${token}`,
        startsAt: new Date("2030-04-01"),
        endsAt: new Date("2031-03-31"),
      },
    });

    const user = await systemPrisma.user.create({ data: { organizationId, email: `fee-assignment-${token}@example.test`, passwordHash: "integration", name: "Fee Assignment", role: Role.SUPER_ADMIN } });
    const otherUser = await systemPrisma.user.create({ data: { organizationId: otherOrganizationId, email: `fee-assignment-other-${token}@example.test`, passwordHash: "integration", name: "Other Fee Assignment", role: Role.SUPER_ADMIN } });
    const branch = await systemPrisma.branch.create({ data: { organizationId, branchCode: `FA-${token}`, branchName: "Fee Assignment Branch" } });
    const otherBranch = await systemPrisma.branch.create({ data: { organizationId: otherOrganizationId, branchCode: `FAO-${token}`, branchName: "Other Fee Assignment Branch" } });
    const course = await systemPrisma.course.create({ data: { organizationId, title: "Fee Assignment Course", slug: `fee-assignment-${token}`, courseCode: `FAC-${token}`, fullDescription: "Integration", regularPricePaise: 0 } });
    const otherCourse = await systemPrisma.course.create({ data: { organizationId: otherOrganizationId, title: "Other Fee Assignment Course", slug: `fee-assignment-other-${token}`, courseCode: `FAOC-${token}`, fullDescription: "Integration", regularPricePaise: 0 } });
    const batch = await systemPrisma.batch.create({ data: { organizationId, name: "Fee Assignment Batch", code: `FAB-${token}`, branchId: branch.id, courseId: course.id, academicSession: session.name, academicSessionId: session.id, startsAt: session.startsAt } });
    const otherBatch = await systemPrisma.batch.create({ data: { organizationId: otherOrganizationId, name: "Other Fee Assignment Batch", code: `FABO-${token}`, branchId: otherBranch.id, courseId: otherCourse.id, academicSession: otherSession.name, academicSessionId: otherSession.id, startsAt: otherSession.startsAt } });
    const studentUser = await systemPrisma.user.create({ data: { organizationId, email: `fee-student-${token}@example.test`, passwordHash: "integration", name: "Fee Student", role: Role.STUDENT } });
    const otherStudentUser = await systemPrisma.user.create({ data: { organizationId: otherOrganizationId, email: `fee-student-other-${token}@example.test`, passwordHash: "integration", name: "Other Fee Student", role: Role.STUDENT } });
    const student = await systemPrisma.studentProfile.create({ data: { organizationId, userId: studentUser.id, admissionNo: `ADM-${token}`, rollNo: "1", gender: Gender.MALE, dateOfBirth: new Date("2012-01-01"), fatherName: "Parent", motherName: "Parent", className: batch.id, parentMobile: "9000000000", address: "Integration", branchId: branch.id, batchId: batch.id, academicSession: session.name, academicSessionId: session.id, admissionDate: session.startsAt } });
    const otherStudent = await systemPrisma.studentProfile.create({ data: { organizationId: otherOrganizationId, userId: otherStudentUser.id, admissionNo: `ADMO-${token}`, rollNo: "1", gender: Gender.MALE, dateOfBirth: new Date("2012-01-01"), fatherName: "Parent", motherName: "Parent", className: otherBatch.id, parentMobile: "9000000001", address: "Integration", branchId: otherBranch.id, batchId: otherBatch.id, academicSession: otherSession.name, academicSessionId: otherSession.id, admissionDate: otherSession.startsAt } });

    const familyKey = `family-${token}`;
    const plan = await systemPrisma.feePlan.create({ data: { organizationId, familyKey, code: `PLAN-${token}`, name: "Assignment Plan", version: 1, status: FeePlanStatus.ACTIVE, academicSessionId: session.id, createdById: user.id } });
    const installment = await systemPrisma.feePlanInstallment.create({ data: { organizationId, planId: plan.id, sequence: 1, title: "First", dueDate: session.startsAt } });
    const components = await Promise.all([
      systemPrisma.feePlanComponent.create({ data: { organizationId, installmentId: installment.id, feeHead: "Tuition", normalizedFeeHead: "tuition", amountPaise: 10_000 } }),
      systemPrisma.feePlanComponent.create({ data: { organizationId, installmentId: installment.id, feeHead: "Laboratory", normalizedFeeHead: "laboratory", amountPaise: 2_500, position: 1 } }),
    ]);
    const planB = await systemPrisma.feePlan.create({ data: { organizationId, familyKey: `other-family-${token}`, code: `PLAN-B-${token}`, name: "Other Assignment Plan", version: 1, status: FeePlanStatus.ACTIVE, academicSessionId: session.id, createdById: user.id } });
    const installmentB = await systemPrisma.feePlanInstallment.create({ data: { organizationId, planId: planB.id, sequence: 1, title: "First", dueDate: session.startsAt } });
    const componentB = await systemPrisma.feePlanComponent.create({ data: { organizationId, installmentId: installmentB.id, feeHead: "Other Tuition", normalizedFeeHead: "other tuition", amountPaise: 5_000 } });

    const assignmentData = {
      organizationId,
      studentId: student.id,
      feePlanId: plan.id,
      academicSessionId: session.id,
      branchId: branch.id,
      batchId: batch.id,
      feePlanFamilyKey: familyKey,
      assignedById: user.id,
    };
    await assert.rejects(
      systemPrisma.studentFeeAssignment.create({ data: { ...assignmentData, feePlanFamilyKey: `wrong-${familyKey}` } }),
      error => known(error, "P2003"),
    );
    await assert.rejects(
      systemPrisma.studentFeeAssignment.create({ data: { ...assignmentData, academicSessionId: alternateSession.id } }),
      error => known(error, "P2003"),
    );

    const application = express(); application.use(express.json()); application.use("/api/v1", feeAssignments); application.use(errorHandler);
    server = application.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server!.once("listening", resolve); server!.once("error", reject); });
    const port = (server.address() as AddressInfo).port;
    const bearer = jwt.sign({ userId: user.id, role: Role.SUPER_ADMIN, organizationId }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const assign = () => fetch(`http://127.0.0.1:${port}/api/v1/finance/fee-assignments`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ studentId: student.id, feePlanId: plan.id }) });
    const responses = await Promise.all([assign(), assign()]);
    const statuses = responses.map(response => response.status);
    assert.equal(statuses.filter(status => status === 201).length, 1);
    assert.ok(statuses.every(status => status === 201 || status === 200 || status === 409));
    const assignment = await systemPrisma.studentFeeAssignment.findFirstOrThrow({ where: { organizationId, studentId: student.id, feePlanId: plan.id } });
    assert.equal(await systemPrisma.studentFeeAssignment.count({ where: { organizationId, studentId: student.id, academicSessionId: session.id, feePlanFamilyKey: familyKey } }), 1);
    assert.equal(await systemPrisma.fee.count({ where: { organizationId, studentFeeAssignmentId: assignment.id } }), components.length);
    assert.equal(await systemPrisma.auditLog.count({ where: { organizationId, action: "STUDENT_FEE_PLAN_ASSIGNED", entityId: assignment.id } }), 1);

    const validAdditionalComponent = await systemPrisma.feePlanComponent.create({ data: { organizationId, installmentId: installment.id, feeHead: "Activities", normalizedFeeHead: "activities", amountPaise: 1_000, position: 2 } });
    const validFee = await systemPrisma.fee.create({ data: { organizationId, studentId: student.id, branchId: branch.id, courseId: course.id, batchId: batch.id, studentFeeAssignmentId: assignment.id, feePlanComponentId: validAdditionalComponent.id, feeHead: validAdditionalComponent.feeHead, totalPaise: validAdditionalComponent.amountPaise, dueDate: new Date(session.startsAt.getTime() + 3 * 86_400_000) } });
    assert.notEqual(plan.id, planB.id);
    assert.equal(assignment.feePlanId, plan.id);
    const componentBFixture = await systemPrisma.feePlanComponent.findUnique({ where: { id: componentB.id }, select: { id: true, installmentId: true } });
    assert.equal(componentBFixture?.installmentId, installmentB.id);
    const installmentBFixture = await systemPrisma.feePlanInstallment.findUnique({ where: { id: installmentB.id }, select: { id: true, planId: true } });
    assert.equal(installmentBFixture?.planId, planB.id);
    await assert.rejects(
      systemPrisma.fee.create({ data: { organizationId, studentId: student.id, branchId: branch.id, courseId: course.id, batchId: batch.id, studentFeeAssignmentId: assignment.id, feePlanComponentId: componentB.id, feeHead: "Wrong plan source", totalPaise: 1, dueDate: new Date(session.startsAt.getTime() + 4 * 86_400_000) } }),
      lineageViolation,
    );
    await assert.rejects(
      systemPrisma.fee.update({ where: { id: validFee.id }, data: { feePlanComponentId: componentB.id } }),
      lineageViolation,
    );

    const version2 = await systemPrisma.feePlan.create({ data: { organizationId, familyKey, code: `PLAN-${token}`, name: "Assignment Plan", version: 2, status: FeePlanStatus.DRAFT, academicSessionId: session.id, createdById: user.id } });
    await assert.rejects(systemPrisma.studentFeeAssignment.create({ data: { organizationId, studentId: student.id, feePlanId: version2.id, academicSessionId: session.id, branchId: branch.id, batchId: batch.id, feePlanFamilyKey: familyKey, assignedById: user.id } }), error => known(error, "P2002"));

    await assert.rejects(systemPrisma.fee.create({ data: { organizationId, studentId: student.id, branchId: branch.id, courseId: course.id, batchId: batch.id, studentFeeAssignmentId: assignment.id, feePlanComponentId: components[0]!.id, feeHead: "Direct duplicate source", totalPaise: 1, dueDate: new Date(session.startsAt.getTime() + 86_400_000) } }), error => known(error, "P2002"));
    await assert.rejects(systemPrisma.fee.create({ data: { organizationId, studentId: student.id, branchId: branch.id, courseId: course.id, batchId: batch.id, studentFeeAssignmentId: assignment.id, feeHead: "Incomplete source", totalPaise: 1, dueDate: new Date(session.startsAt.getTime() + 172_800_000) } }), error => String(error).includes("Fee_generated_source_pair_check"));

    const otherPlan = await systemPrisma.feePlan.create({ data: { organizationId: otherOrganizationId, familyKey: `other-family-${token}`, code: `OTHER-${token}`, name: "Other Assignment Plan", version: 1, status: FeePlanStatus.ACTIVE, academicSessionId: otherSession.id, createdById: otherUser.id } });
    const otherInstallment = await systemPrisma.feePlanInstallment.create({ data: { organizationId: otherOrganizationId, planId: otherPlan.id, sequence: 1, title: "First", dueDate: otherSession.startsAt } });
    const otherComponent = await systemPrisma.feePlanComponent.create({ data: { organizationId: otherOrganizationId, installmentId: otherInstallment.id, feeHead: "Other Tuition", normalizedFeeHead: "other tuition", amountPaise: 5_000 } });
    const otherAssignment = await systemPrisma.studentFeeAssignment.create({ data: { organizationId: otherOrganizationId, studentId: otherStudent.id, feePlanId: otherPlan.id, academicSessionId: otherSession.id, branchId: otherBranch.id, batchId: otherBatch.id, feePlanFamilyKey: otherPlan.familyKey, assignedById: otherUser.id } });
    const crossTenantFee = (source: { assignmentId: string; componentId: string }, offset: number) => systemPrisma.fee.create({ data: { organizationId: otherOrganizationId, studentId: otherStudent.id, branchId: otherBranch.id, courseId: otherCourse.id, batchId: otherBatch.id, studentFeeAssignmentId: source.assignmentId, feePlanComponentId: source.componentId, feeHead: `Cross tenant ${offset}`, totalPaise: 1, dueDate: new Date(otherSession.startsAt.getTime() + offset * 86_400_000) } });
    await assert.rejects(crossTenantFee({ assignmentId: assignment.id, componentId: otherComponent.id }, 3), error => known(error, "P2003"));
    await assert.rejects(crossTenantFee({ assignmentId: otherAssignment.id, componentId: components[0]!.id }, 4), error => known(error, "P2003"));
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    assertSafeTarget();
    for (const targetOrganizationId of [organizationId, otherOrganizationId]) {
      await systemPrisma.$transaction(async tx => {
        await tx.fee.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.studentFeeAssignment.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.feePlanComponent.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.feePlanInstallment.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.feePlan.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.auditLog.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.studentProfile.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.batch.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.course.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.branch.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.user.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
        await tx.academicSession.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.organization.deleteMany({ where: { id: targetOrganizationId } });
        await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
      });
    }
  }
});
