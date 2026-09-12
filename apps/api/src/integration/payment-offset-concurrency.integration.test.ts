import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Gender, PaymentMode, Prisma, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import paymentOffsets from "../routes/payment-offsets.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
function assertSafeTarget() {
  const configured = process.env.TEST_DATABASE_URL;
  let parsed: URL | null = null;
  try { parsed = configured ? new URL(configured) : null; } catch { parsed = null; }
  const name = parsed?.pathname.replace(/^\//, "") ?? "";
  if (!configured || process.env.DATABASE_URL !== configured || !parsed || !["postgres:", "postgresql:"].includes(parsed.protocol) || !new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname) || !/(^|[_-])(test|integration)([_-]|$)/i.test(name)) throw new Error("Refusing payment-offset integration test outside a local TEST_DATABASE_URL");
}

test("real PostgreSQL serializes and caps payment refunds/reversals", { skip: !enabled, timeout: 90_000 }, async () => {
  assertSafeTarget();
  const token = crypto.randomUUID();
  const organizationId = `payment-offset-${token}`;
  const otherOrganizationId = `payment-offset-other-${token}`;
  let branchId: string | undefined;
  let batchId: string | undefined;
  let studentId: string | undefined;
  let paymentId: string | undefined;
  let server: Server | undefined;
  try {
    await systemPrisma.organization.create({ data: { id: organizationId, slug: organizationId, name: organizationId, email: `${organizationId}@example.test` } });
    await systemPrisma.organization.create({ data: { id: otherOrganizationId, slug: otherOrganizationId, name: otherOrganizationId, email: `${otherOrganizationId}@example.test` } });
    const user = await systemPrisma.user.create({ data: { organizationId, email: `${organizationId}@example.test`, passwordHash: "integration", name: "Offset Admin", role: Role.SUPER_ADMIN } });
    const session = await systemPrisma.academicSession.create({ data: { organizationId, name: `Offset ${token}`, startsAt: new Date("2030-04-01"), endsAt: new Date("2031-03-31"), isCurrent: false } });
    const branch = await systemPrisma.branch.create({ data: { organizationId, branchCode: `PO-${token}`, branchName: "Offset Branch" } }); branchId = branch.id;
    const batch = await systemPrisma.batch.create({ data: { organizationId, name: "Offset Batch", code: `POB-${token}`, branchId: branch.id, academicSession: session.name, academicSessionId: session.id, startsAt: session.startsAt } }); batchId = batch.id;
    const studentUser = await systemPrisma.user.create({ data: { organizationId, email: `student-${organizationId}@example.test`, passwordHash: "integration", name: "Offset Student", role: Role.STUDENT } });
    const student = await systemPrisma.studentProfile.create({ data: { organizationId, userId: studentUser.id, admissionNo: `PO-${token}`, rollNo: "1", gender: Gender.MALE, dateOfBirth: new Date("2012-01-01"), fatherName: "Parent", motherName: "Parent", className: "Offset", parentMobile: "9000000000", address: "Integration", branchId: branch.id, batchId: batch.id, academicSession: session.name, academicSessionId: session.id, admissionDate: session.startsAt } }); studentId = student.id;
    const fee = await systemPrisma.fee.create({ data: { organizationId, studentId: student.id, branchId: branch.id, batchId: batch.id, feeHead: "Tuition", totalPaise: 10_000, amountPaidPaise: 10_000, dueDate: new Date("2030-06-01") } });
    const payment = await systemPrisma.feePayment.create({ data: { organizationId, feeId: fee.id, amountPaise: 10_000, paymentMode: PaymentMode.UPI, receiptNumber: `PO-R-${token}` } }); paymentId = payment.id;
    const payment2 = await systemPrisma.feePayment.create({ data: { organizationId, feeId: fee.id, amountPaise: 10_000, paymentMode: PaymentMode.UPI, receiptNumber: `PO-R2-${token}` } });
    const payment3 = await systemPrisma.feePayment.create({ data: { organizationId, feeId: fee.id, amountPaise: 10_000, paymentMode: PaymentMode.UPI, receiptNumber: `PO-R3-${token}` } });
    const attempt = (target: typeof payment, amountPaise: number, type: "REFUND" | "REVERSAL", key: string) => systemPrisma.feePaymentOffset.create({ data: { organizationId, feePaymentId: target.id, feeId: fee.id, amountPaise, type, reason: type, idempotencyKey: key, createdById: user.id } });
    const concurrent = await Promise.allSettled([attempt(payment, 7_000, "REFUND", "r1"), attempt(payment, 7_000, "REFUND", "r2")]);
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
    assert.ok((await systemPrisma.feePaymentOffset.aggregate({ where: { organizationId, feePaymentId: payment.id }, _sum: { amountPaise: true } }))._sum.amountPaise! <= 10_000);
    const mixed = await Promise.allSettled([attempt(payment2, 6_000, "REFUND", "mixed-r"), attempt(payment2, 6_000, "REVERSAL", "mixed-v")]);
    assert.ok(mixed.filter(result => result.status === "fulfilled").length <= 1);
    assert.ok((await systemPrisma.feePaymentOffset.aggregate({ where: { organizationId, feePaymentId: payment2.id }, _sum: { amountPaise: true } }))._sum.amountPaise! <= 10_000);
    const idem = await Promise.allSettled([attempt(payment3, 2_000, "REFUND", "same-key"), attempt(payment3, 2_000, "REFUND", "same-key")]);
    assert.equal(idem.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await systemPrisma.feePaymentOffset.count({ where: { organizationId, feePaymentId: payment3.id, idempotencyKey: "same-key" } }), 1);

    const applicationFee = await systemPrisma.fee.create({ data: { organizationId, studentId: student.id, branchId: branch.id, batchId: batch.id, feeHead: "Application consistency", totalPaise: 8_000, amountPaidPaise: 8_000, dueDate: new Date("2030-06-01") } });
    const applicationPayment = await systemPrisma.feePayment.create({ data: { organizationId, feeId: applicationFee.id, amountPaise: 8_000, paymentMode: PaymentMode.UPI, receiptNumber: `PO-APP-${token}` } });
    const application = express(); application.use(express.json()); application.use("/api/v1", paymentOffsets); application.use(errorHandler);
    server = application.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server!.once("listening", resolve); server!.once("error", reject); });
    const port = (server.address() as AddressInfo).port;
    const bearer = jwt.sign({ userId: user.id, role: Role.SUPER_ADMIN, organizationId }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const request = () => fetch(`http://127.0.0.1:${port}/api/v1/finance/payments/${applicationPayment.id}/refunds`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ amountPaise: 2_000, reason: "Application idempotency", idempotencyKey: "application-same-key" }) });
    const responses = await Promise.all([request(), request()]);
    assert.ok(responses.every(response => response.status === 201 || response.status === 200));
    assert.equal(await systemPrisma.feePaymentOffset.count({ where: { organizationId, feePaymentId: applicationPayment.id, idempotencyKey: "application-same-key" } }), 1);
    assert.equal((await systemPrisma.fee.findUnique({ where: { id: applicationFee.id }, select: { amountPaidPaise: true } }))?.amountPaidPaise, 6_000);
    const applicationOffset = await systemPrisma.feePaymentOffset.findFirstOrThrow({ where: { organizationId, feePaymentId: applicationPayment.id, idempotencyKey: "application-same-key" } });
    assert.equal(await systemPrisma.auditLog.count({ where: { organizationId, action: "FEE_PAYMENT_REFUNDED", entityId: applicationOffset.id } }), 1);
    assert.equal((await systemPrisma.feePayment.findUnique({ where: { id: applicationPayment.id }, select: { amountPaise: true } }))?.amountPaise, 8_000);
    await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined;
    await assert.rejects(attempt(payment, 4_000, "REVERSAL", "over"), error => String(error).includes("Payment offsets cannot exceed original payment amount"));
    await assert.rejects(systemPrisma.feePaymentOffset.create({ data: { organizationId, feePaymentId: payment.id, feeId: fee.id, amountPaise: 0, type: "REFUND", reason: "invalid", idempotencyKey: "zero", createdById: user.id } }), error => String(error).includes("FeePaymentOffset_amountPaise_positive_check"));
    const otherUser = await systemPrisma.user.create({ data: { organizationId: otherOrganizationId, email: `other-${organizationId}@example.test`, passwordHash: "integration", name: "Other Offset Admin", role: Role.SUPER_ADMIN } });
    await assert.rejects(systemPrisma.feePaymentOffset.create({ data: { organizationId: otherOrganizationId, feePaymentId: payment.id, feeId: fee.id, amountPaise: 1, type: "REFUND", reason: "cross-tenant", idempotencyKey: "cross-tenant", createdById: otherUser.id } }), error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003");
  } finally {
    if (!process.env.TEST_DATABASE_URL) return;
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    for (const targetOrganizationId of [organizationId, otherOrganizationId]) {
      await systemPrisma.$transaction(async tx => {
        await tx.feePaymentOffset.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.feePayment.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.fee.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.auditLog.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.studentProfile.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.batch.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.branch.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.user.deleteMany({ where: { organizationId: targetOrganizationId } });
        await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
        try {
          await tx.academicSession.deleteMany({ where: { organizationId: targetOrganizationId } });
          assert.equal(await tx.academicSession.count({ where: { organizationId: targetOrganizationId } }), 0, `AcademicSession cleanup left rows for ${targetOrganizationId}`);
          await tx.organization.deleteMany({ where: { id: targetOrganizationId } });
        } finally {
          await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
        }
      });
    }
  }
});
