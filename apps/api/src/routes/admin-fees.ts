import crypto from "node:crypto";
import { FeeStatus, PaymentMode, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireRequestedBranch } from "../lib/branch-policy.js";
import { assertFeeCanBeDeleted, assertFinanceBranchAccess, assertPaidFeeIdentityUnchanged, assertPaymentWithinAuthoritativeBalance, feeStatus, isSerializableConflict, safeFinanceAuditMetadata } from "../lib/finance-integrity.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT));
router.use((req: AuthRequest, _res, next) => {
  const collection = req.method === "POST" && /^\/fees\/[^/]+\/collect$/.test(req.path);
  if (req.auth?.role === Role.ACCOUNTANT && !(req.method === "GET" || collection)) {
    return next(new AppError(403, "ACCOUNTANT_FEE_READ_ONLY", "Accountants may only collect payments or read fee records"));
  }
  next();
});

const input = z.object({
  studentId: z.string().cuid(), branchId: z.string().cuid(),
  courseId: z.string().cuid().nullable().optional(), batchId: z.string().cuid().nullable().optional(),
  feeHead: z.string().trim().min(2).max(120), totalPaise: z.number().int().positive(),
  discountPaise: z.number().int().min(0).default(0), finePaise: z.number().int().min(0).default(0),
  dueDate: z.coerce.date(), remarks: z.string().trim().max(2000).nullable().optional(),
});
const select = {
  id: true, feeHead: true, totalPaise: true, discountPaise: true, finePaise: true, amountPaidPaise: true,
  dueDate: true, status: true, remarks: true, createdAt: true, updatedAt: true,
  student: { select: { id: true, admissionNo: true, user: { select: { id: true, name: true, email: true } } } },
  branch: { select: { id: true, branchName: true, branchCode: true } },
  course: { select: { id: true, title: true, courseCode: true } }, batch: { select: { id: true, name: true, code: true } },
  payments: { orderBy: { paymentDate: "desc" as const } },
} as const;
const decorate = <T extends { totalPaise: number; discountPaise: number; finePaise: number; amountPaidPaise: number }>(fee: T) => ({ ...fee, balancePaise: Math.max(0, fee.totalPaise - fee.discountPaise + fee.finePaise - fee.amountPaidPaise) });
const dateOnly = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

async function assignedBranchIds(req: AuthRequest) {
  if (req.auth!.role !== Role.BRANCH_ADMIN && req.auth!.role !== Role.ACCOUNTANT) return [];
  return (await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } })).map(item => item.branchId);
}
async function branchWhere(req: AuthRequest, requestedBranchId?: string) {
  return requireRequestedBranch(req.auth!.role, await assignedBranchIds(req), requestedBranchId);
}
async function access(req: AuthRequest, branchId: string) {
  assertFinanceBranchAccess(req.auth!.role, await assignedBranchIds(req), branchId);
}
async function relations(db: Prisma.TransactionClient | typeof prisma, data: { studentId: string; branchId: string; courseId?: string | null; batchId?: string | null }) {
  const student = await db.studentProfile.findUnique({ where: { id: data.studentId }, select: { branchId: true, batchId: true, batch: { select: { courseId: true } } } });
  if (!student || student.branchId !== data.branchId) throw new AppError(422, "INVALID_STUDENT_BRANCH", "Student must belong to the selected branch");
  if (data.batchId && student.batchId !== data.batchId) throw new AppError(422, "INVALID_STUDENT_BATCH", "Student must belong to the selected batch");
  if (data.courseId && student.batch?.courseId !== data.courseId) throw new AppError(422, "INVALID_STUDENT_COURSE", "Course must match the student's batch");
}
function amounts(value: { totalPaise: number; discountPaise: number; finePaise: number }, paid = 0) {
  if (value.discountPaise > value.totalPaise) throw new AppError(422, "INVALID_DISCOUNT", "Discount cannot exceed total amount");
  if (value.totalPaise - value.discountPaise + value.finePaise < paid) throw new AppError(422, "AMOUNT_BELOW_PAID", "Net fee cannot be less than amount already paid");
}
const auditRecord = (req: AuthRequest, action: string, entity: string, entityId: string, metadata: object) => ({ organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action, entity, entityId, metadata: safeFinanceAuditMetadata(metadata) });

router.get("/fees/dashboard", async (req: AuthRequest, res) => {
  const query = z.object({ branchId: z.string().cuid().optional() }).parse(req.query), where = await branchWhere(req, query.branchId);
  const [fees, payments] = await Promise.all([
    prisma.fee.findMany({ where, select: { totalPaise: true, discountPaise: true, finePaise: true, amountPaidPaise: true, dueDate: true, status: true } }),
    prisma.feePayment.aggregate({ _sum: { amountPaise: true }, where: { paymentDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }, fee: where } }),
  ]);
  let total = 0, paid = 0, pending = 0, overdue = 0;
  for (const item of fees) { const net = item.totalPaise - item.discountPaise + item.finePaise; total += net; paid += item.amountPaidPaise; pending += Math.max(0, net - item.amountPaidPaise); if (item.amountPaidPaise < net && dateOnly(item.dueDate) < dateOnly(new Date())) overdue++; }
  res.json({ data: { records: fees.length, totalPaise: total, paidPaise: paid, pendingPaise: pending, overdue, dailyCollectionPaise: payments._sum.amountPaise ?? 0 } });
});
router.get("/fees/reports", async (req: AuthRequest, res) => {
  const query = z.object({ from: z.coerce.date(), to: z.coerce.date(), branchId: z.string().cuid().optional() }).parse(req.query), fee = await branchWhere(req, query.branchId);
  const payments = await prisma.feePayment.findMany({ where: { paymentDate: { gte: query.from, lte: query.to }, fee }, include: { fee: { include: { student: { include: { user: true } }, branch: true } } }, orderBy: { paymentDate: "asc" } });
  res.json({ data: { totalPaise: payments.reduce((sum, item) => sum + item.amountPaise, 0), payments } });
});
router.get("/fees/export", async (req: AuthRequest, res) => {
  const query = z.object({ format: z.enum(["pdf", "excel"]), from: z.coerce.date(), to: z.coerce.date() }).parse(req.query), fee = await branchWhere(req);
  const rows = await prisma.feePayment.findMany({ where: { paymentDate: { gte: query.from, lte: query.to }, fee }, include: { fee: { include: { student: { include: { user: true } }, branch: true } } }, orderBy: { paymentDate: "asc" } });
  const data = rows.map(item => [item.paymentDate.toISOString().slice(0, 10), item.receiptNumber, item.fee.student.user.name, item.fee.student.admissionNo, item.fee.branch.branchName, item.amountPaise / 100, item.paymentMode, item.transactionId ?? ""]);
  if (query.format === "excel") { const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Collections"><Table>${[["Date", "Receipt", "Student", "Admission", "Branch", "Amount", "Mode", "Transaction"], ...data].map(row => `<Row>${row.map(value => `<Cell><Data ss:Type="String">${String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`; res.set({ "Content-Type": "application/vnd.ms-excel", "Content-Disposition": "attachment; filename=fee-collections.xls" }).send(xml); return; }
  sendPdf(res, "Fee Collection Report", data.map(row => row.join(" | ")), "fee-collections.pdf");
});
router.get("/fees/student/:studentId/ledger", async (req: AuthRequest, res) => {
  const studentId = String(req.params.studentId), student = await prisma.studentProfile.findUnique({ where: { id: studentId }, select: { branchId: true } });
  if (!student) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found"); await access(req, student.branchId);
  res.json({ data: (await prisma.fee.findMany({ where: { studentId }, select, orderBy: { dueDate: "desc" } })).map(decorate) });
});
router.get("/fees", async (req: AuthRequest, res) => {
  const query = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().optional(), branchId: z.string().cuid().optional(), courseId: z.string().cuid().optional(), batchId: z.string().cuid().optional(), studentId: z.string().cuid().optional(), status: z.nativeEnum(FeeStatus).optional(), sortBy: z.enum(["feeHead", "totalPaise", "amountPaidPaise", "dueDate", "status", "createdAt"]).default("createdAt"), sortOrder: z.enum(["asc", "desc"]).default("desc") }).parse(req.query);
  const where = { ...await branchWhere(req, query.branchId), ...(query.courseId ? { courseId: query.courseId } : {}), ...(query.batchId ? { batchId: query.batchId } : {}), ...(query.studentId ? { studentId: query.studentId } : {}), ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ feeHead: { contains: query.search, mode: "insensitive" as const } }, { student: { admissionNo: { contains: query.search, mode: "insensitive" as const } } }, { student: { user: { name: { contains: query.search, mode: "insensitive" as const } } } }, { payments: { some: { receiptNumber: { contains: query.search, mode: "insensitive" as const } } } }] } : {}) };
  const [total, data] = await prisma.$transaction([prisma.fee.count({ where }), prisma.fee.findMany({ where, select, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { [query.sortBy]: query.sortOrder } })]);
  res.json({ data: data.map(decorate), meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});
router.get("/fees/:id", async (req: AuthRequest, res) => {
  const data = await prisma.fee.findUnique({ where: { id: String(req.params.id) }, select }); if (!data) throw new AppError(404, "FEE_NOT_FOUND", "Fee not found"); await access(req, data.branch.id); res.json({ data: decorate(data) });
});
router.post("/fees", allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  const data = input.parse(req.body); amounts(data); const permittedBranchIds = await assignedBranchIds(req); assertFinanceBranchAccess(req.auth!.role, permittedBranchIds, data.branchId); const dueDate = dateOnly(data.dueDate);
  try {
    const created = await prisma.$transaction(async tx => { assertFinanceBranchAccess(req.auth!.role, permittedBranchIds, data.branchId); await relations(tx, data); if (await tx.fee.findFirst({ where: { studentId: data.studentId, batchId: data.batchId ?? null, feeHead: { equals: data.feeHead, mode: "insensitive" }, dueDate }, select: { id: true } })) throw new AppError(409, "FEE_EXISTS", "This fee record already exists"); const fee = await tx.fee.create({ data: { ...data, dueDate, status: feeStatus(data.totalPaise, data.discountPaise, data.finePaise, 0, dueDate) }, select }); await tx.auditLog.create({ data: auditRecord(req, "FEE_CREATED", "Fee", fee.id, { branchId: data.branchId, totalPaise: data.totalPaise, discountPaise: data.discountPaise, finePaise: data.finePaise }) }); return fee; }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ data: decorate(created) });
  } catch (error) {
    if (isSerializableConflict(error)) throw new AppError(409, "FEE_CONFLICT", "A matching fee changed; reload and try again");
    throw error;
  }
});
router.patch("/fees/:id", allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  const permittedBranchIds = await assignedBranchIds(req), data = input.partial().parse(req.body);
  try {
    const updated = await prisma.$transaction(async tx => {
      const old = await tx.fee.findUnique({ where: { id: String(req.params.id) }, select: { id: true, studentId: true, branchId: true, courseId: true, batchId: true, feeHead: true, totalPaise: true, discountPaise: true, finePaise: true, amountPaidPaise: true, dueDate: true, _count: { select: { payments: true } } } }); if (!old) throw new AppError(404, "FEE_NOT_FOUND", "Fee not found"); assertFinanceBranchAccess(req.auth!.role, permittedBranchIds, old.branchId);
      const dueDate = data.dueDate ? dateOnly(data.dueDate) : old.dueDate; assertPaidFeeIdentityUnchanged(old, { ...data, ...(data.dueDate ? { dueDate } : {}) }, old._count.payments);
      const merged = { studentId: data.studentId ?? old.studentId, branchId: data.branchId ?? old.branchId, courseId: data.courseId === undefined ? old.courseId : data.courseId, batchId: data.batchId === undefined ? old.batchId : data.batchId }; assertFinanceBranchAccess(req.auth!.role, permittedBranchIds, merged.branchId); await relations(tx, merged);
      const totalPaise = data.totalPaise ?? old.totalPaise, discountPaise = data.discountPaise ?? old.discountPaise, finePaise = data.finePaise ?? old.finePaise; amounts({ totalPaise, discountPaise, finePaise }, old.amountPaidPaise);
      const fee = await tx.fee.update({ where: { id: old.id }, data: { ...data, ...(data.dueDate ? { dueDate } : {}), status: feeStatus(totalPaise, discountPaise, finePaise, old.amountPaidPaise, dueDate) }, select }); await tx.auditLog.create({ data: auditRecord(req, "FEE_UPDATED", "Fee", old.id, { changedFields: Object.keys(data), previousDiscountPaise: old.discountPaise, discountPaise, previousFinePaise: old.finePaise, finePaise }) }); return fee;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ data: decorate(updated) });
  } catch (error) {
    if (isSerializableConflict(error)) throw new AppError(409, "FEE_UPDATE_CONFLICT", "The fee changed; reload and try again");
    throw error;
  }
});
router.post("/fees/:id/collect", async (req: AuthRequest, res) => {
  const data = z.object({ amountPaise: z.number().int().positive(), paymentDate: z.coerce.date().default(() => new Date()), paymentMode: z.nativeEnum(PaymentMode), transactionId: z.string().trim().min(2).max(120).nullable().optional(), remarks: z.string().trim().max(1000).nullable().optional() }).parse(req.body);
  const permittedBranchIds = await assignedBranchIds(req);
  try {
    const result = await prisma.$transaction(async tx => {
      const fee = await tx.fee.findUnique({ where: { id: String(req.params.id) }, select: { id: true, branchId: true, totalPaise: true, discountPaise: true, finePaise: true, dueDate: true } }); if (!fee) throw new AppError(404, "FEE_NOT_FOUND", "Fee not found"); assertFinanceBranchAccess(req.auth!.role, permittedBranchIds, fee.branchId);
      if (data.transactionId && await tx.feePayment.findUnique({ where: { transactionId: data.transactionId }, select: { id: true } })) throw new AppError(409, "TRANSACTION_EXISTS", "Transaction ID already exists");
      const before = await tx.feePayment.aggregate({ where: { feeId: fee.id }, _sum: { amountPaise: true } }), paidBefore = before._sum.amountPaise ?? 0;
      assertPaymentWithinAuthoritativeBalance(fee.totalPaise, fee.discountPaise, fee.finePaise, paidBefore, data.amountPaise);
      const receiptNumber = `BBA-FEE-${crypto.randomUUID().toUpperCase()}`, payment = await tx.feePayment.create({ data: { feeId: fee.id, ...data, receiptNumber, collectedById: req.auth!.userId } });
      const authoritative = await tx.feePayment.aggregate({ where: { feeId: fee.id }, _sum: { amountPaise: true } }), amountPaidPaise = authoritative._sum.amountPaise ?? 0;
      const updated = await tx.fee.update({ where: { id: fee.id }, data: { amountPaidPaise, status: feeStatus(fee.totalPaise, fee.discountPaise, fee.finePaise, amountPaidPaise, fee.dueDate) }, select });
      await tx.auditLog.create({ data: auditRecord(req, "PAYMENT_CREATED", "FeePayment", payment.id, { feeId: fee.id, branchId: fee.branchId, amountPaise: data.amountPaise, paymentMode: data.paymentMode, receiptNumber, previousPaidPaise: paidBefore, amountPaidPaise }) });
      await tx.auditLog.create({ data: auditRecord(req, "RECEIPT_ISSUED", "FeePayment", payment.id, { feeId: fee.id, receiptNumber, amountPaise: data.amountPaise }) });
      return { payment, fee: decorate(updated) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ data: result });
  } catch (error) {
    if (isSerializableConflict(error)) throw new AppError(409, "PAYMENT_CONFLICT", "The fee balance changed; reload and try again");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "PAYMENT_DUPLICATE", "This payment reference or receipt already exists");
    throw error;
  }
});
router.get("/fees/payments/:paymentId/receipt", async (req: AuthRequest, res) => {
  const payment = await prisma.feePayment.findUnique({ where: { id: String(req.params.paymentId) }, include: { fee: { include: { student: { include: { user: true } }, branch: true, course: true, batch: true } } } }); if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found"); await access(req, payment.fee.branchId);
  await prisma.auditLog.create({ data: auditRecord(req, "RECEIPT_REGENERATED", "FeePayment", payment.id, { feeId: payment.feeId, receiptNumber: payment.receiptNumber, amountPaise: payment.amountPaise }) });
  sendPdf(res, "Fee Receipt", [`Receipt: ${payment.receiptNumber}`, `Student: ${payment.fee.student.user.name} (${payment.fee.student.admissionNo})`, `Fee: ${payment.fee.feeHead}`, `Amount: INR ${(payment.amountPaise / 100).toFixed(2)}`, `Mode: ${payment.paymentMode}`, `Transaction: ${payment.transactionId ?? "-"}`, `Date: ${payment.paymentDate.toISOString()}`], `${payment.receiptNumber}.pdf`);
});
router.delete("/fees/:id", allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  const permittedBranchIds = await assignedBranchIds(req);
  try {
    await prisma.$transaction(async tx => {
      const fee = await tx.fee.findUnique({ where: { id: String(req.params.id) }, select: { id: true, branchId: true, amountPaidPaise: true, _count: { select: { payments: true } } } });
      if (!fee) throw new AppError(404, "FEE_NOT_FOUND", "Fee not found");
      assertFinanceBranchAccess(req.auth!.role, permittedBranchIds, fee.branchId);
      const adjustmentCount = await tx.feeAdjustment.count({ where: { feeId: fee.id } });
      assertFeeCanBeDeleted(fee.amountPaidPaise, fee._count.payments, adjustmentCount);
      await tx.fee.delete({ where: { id: fee.id } });
      await tx.auditLog.create({ data: auditRecord(req, "FEE_DELETED", "Fee", fee.id, { branchId: fee.branchId }) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(204).send();
  } catch (error) {
    if (isSerializableConflict(error)) throw new AppError(409, "FEE_DELETE_CONFLICT", "The fee changed; reload and try again");
    throw error;
  }
});

function sendPdf(res: any, title: string, lines: string[], file: string) {
  const content = [title, ...lines].slice(0, 45).map((line, index) => `BT /F1 10 Tf 40 ${800 - index * 18} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n"), objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename=${file}` }).send(Buffer.from(pdf));
}
export default router;
