import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { parseInstitutionDateTimeOrInstant } from "../lib/institution-time.js";
import { assignedBranchIds, communicationScope } from "../lib/communication-authorization.js";
import { noticeRecipientConstraints } from "../lib/notice-policy.js";
import { prisma } from "../lib/prisma.js";
import { storedDocumentBuffer, storedDocumentHeaders } from "../lib/secure-download.js";
import { assertCommunicationFileExtension, decodeVerifiedCommunicationUpload, type AllowedCommunicationAttachmentType } from "../lib/secure-upload.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const admins: Role[] = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN];
const id = z.string().cuid();
const input = z.object({
  title: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(100000), branchId: id.nullable().optional(), batchId: id.nullable().optional(), audience: z.nativeEnum(Role).nullable().optional(), category: z.string().trim().max(80).nullable().optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"), publishedAt: z.string().trim().min(1).optional(), expiresAt: z.string().trim().min(1).nullable().optional(), isPinned: z.boolean().default(false), requiresAcknowledgement: z.boolean().default(false), isArchived: z.boolean().default(false), attachment: z.object({ name: z.string().trim().min(1).max(180), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]), base64: z.string().min(1) }).nullable().optional(),
});

async function assignedBranches(req: AuthRequest) { return assignedBranchIds(req.auth!.userId); }
async function requireBranch(req: AuthRequest, branchId?: string | null) { if (req.auth!.role === Role.BRANCH_ADMIN && (!branchId || !(await assignedBranches(req)).includes(branchId))) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied"); }
function attachment(value: z.infer<typeof input>["attachment"]) {
  if (!value) return {};
  assertCommunicationFileExtension(value.name, value.mimeType as AllowedCommunicationAttachmentType);
  const data = decodeVerifiedCommunicationUpload(value.base64, value.mimeType as AllowedCommunicationAttachmentType, 5 * 1024 * 1024);
  return { attachmentName: value.name, attachmentMime: value.mimeType, attachmentData: data };
}
async function institutionDates(req: AuthRequest, value: { publishedAt?: string; expiresAt?: string | null }) {
  if (value.publishedAt === undefined && value.expiresAt === undefined) return {};
  const organization = await prisma.organization.findUnique({ where: { id: req.auth!.organizationId }, select: { timezone: true } });
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  return {
    ...(value.publishedAt === undefined ? {} : { publishedAt: parseInstitutionDateTimeOrInstant(value.publishedAt, organization.timezone) }),
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt === null ? null : parseInstitutionDateTimeOrInstant(value.expiresAt, organization.timezone) }),
  };
}
type NoticeTarget = { branchId?: string | null; batchId?: string | null; publishedAt?: Date; expiresAt?: Date | null };
async function validateTarget(req: AuthRequest, candidate: NoticeTarget, existing: NoticeTarget = {}) {
  const branchId = candidate.branchId !== undefined ? candidate.branchId : existing.branchId;
  const batchId = candidate.batchId !== undefined ? candidate.batchId : existing.batchId;
  const publishedAt = candidate.publishedAt !== undefined ? candidate.publishedAt : existing.publishedAt ?? new Date();
  const expiresAt = candidate.expiresAt !== undefined ? candidate.expiresAt : existing.expiresAt;
  await requireBranch(req, branchId);
  if (expiresAt && expiresAt <= publishedAt) throw new AppError(422, "INVALID_EXPIRY", "Expiry must follow publication");
  if (batchId) {
    const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { branchId: true } });
    if (!batch || !branchId || batch.branchId !== branchId) throw new AppError(422, "INVALID_NOTICE_BATCH", "Batch must belong to the selected branch");
  }
}

async function recipientConstraints(req: AuthRequest) {
  const { role, branchIds, batchIds } = await communicationScope(req);
  return noticeRecipientConstraints(role, branchIds, batchIds);
}

router.get("/notices", async (req: AuthRequest, res) => {
  const q = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().optional(), category: z.string().optional(), archived: z.enum(["true", "false"]).optional() }).parse(req.query), eligibility = admins.includes(req.auth!.role) ? { AND: req.auth!.role === Role.BRANCH_ADMIN ? [{ OR: [{ branchId: null }, { branchId: { in: await assignedBranches(req) } }] }] : [] } : await recipientConstraints(req);
  const where = { kind: "NOTICE", isArchived: q.archived === "true", deletedAt: null, ...eligibility, ...(q.category ? { category: q.category } : {}), ...(q.search ? { AND: [...eligibility.AND, { OR: [{ title: { contains: q.search, mode: "insensitive" as const } }, { body: { contains: q.search, mode: "insensitive" as const } }] }] } : {}) };
  const [data, total] = await prisma.$transaction([prisma.announcement.findMany({ where, select: { id: true, title: true, body: true, category: true, priority: true, audience: true, isPinned: true, requiresAcknowledgement: true, publishedAt: true, expiresAt: true, isArchived: true, attachmentName: true, branch: { select: { id: true, branchName: true } }, batch: { select: { id: true, name: true } }, author: { select: { name: true } }, reads: { where: { userId: req.auth!.userId }, select: { readAt: true } }, _count: { select: { reads: true } } }, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }] }), prisma.announcement.count({ where })]);
  res.json({ data, meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});

router.post("/admin/notices", async (req: AuthRequest, res) => { if (!admins.includes(req.auth!.role)) throw new AppError(403, "ADMIN_REQUIRED", "Administrator access is required"); const raw = input.parse(req.body), { publishedAt, expiresAt, ...fields } = raw, data = { ...fields, ...await institutionDates(req, { publishedAt, expiresAt }) }; await validateTarget(req, data); const { attachment: file, ...rest } = data, notice = await prisma.announcement.create({ data: { ...rest, kind: "NOTICE", authorId: req.auth!.userId, ...attachment(file) } }); await prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: "CREATE", entity: "Notice", entityId: notice.id } }); res.status(201).json({ data: { ...notice, attachmentData: undefined } }); });
router.patch("/admin/notices/:noticeId", async (req: AuthRequest, res) => { if (!admins.includes(req.auth!.role)) throw new AppError(403, "ADMIN_REQUIRED", "Administrator access is required"); const old = await prisma.announcement.findFirst({ where: { id: id.parse(req.params.noticeId), kind: "NOTICE" } }); if (!old) throw new AppError(404, "NOTICE_NOT_FOUND", "Notice not found"); await requireBranch(req, old.branchId); const raw = input.partial().parse(req.body), { publishedAt, expiresAt, ...fields } = raw, data = { ...fields, ...await institutionDates(req, { publishedAt, expiresAt }) }; await validateTarget(req, data, old); const { attachment: file, ...rest } = data, notice = await prisma.announcement.update({ where: { id: old.id }, data: { ...rest, ...(file === undefined ? {} : attachment(file)) } }); await prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: "UPDATE", entity: "Notice", entityId: notice.id } }); res.json({ data: { ...notice, attachmentData: undefined } }); });
router.post("/notices/:noticeId/acknowledge", async (req: AuthRequest, res) => {
  const eligibility = await recipientConstraints(req);
  const notice = await prisma.announcement.findFirst({ where: { id: id.parse(req.params.noticeId), organizationId: req.auth!.organizationId, kind: "NOTICE", requiresAcknowledgement: true, isArchived: false, deletedAt: null, ...eligibility }, select: { id: true } });
  if (!notice) throw new AppError(404, "NOTICE_NOT_FOUND", "Notice not found");
  res.status(201).json({ data: await prisma.announcementRead.upsert({ where: { announcementId_userId: { announcementId: notice.id, userId: req.auth!.userId } }, update: {}, create: { organizationId: req.auth!.organizationId, announcementId: notice.id, userId: req.auth!.userId } }) });
});
router.get("/notices/:noticeId/attachment", async (req: AuthRequest, res) => {
  const access = admins.includes(req.auth!.role)
    ? { AND: req.auth!.role === Role.BRANCH_ADMIN ? [{ OR: [{ branchId: null }, { branchId: { in: await assignedBranches(req) } }] }] : [] }
    : await recipientConstraints(req);
  const notice = await prisma.announcement.findFirst({ where: { id: id.parse(req.params.noticeId), kind: "NOTICE", deletedAt: null, isArchived: false, ...access }, select: { attachmentName: true, attachmentMime: true, attachmentData: true } });
  if (!notice?.attachmentName || !notice.attachmentMime || !notice.attachmentData) throw new AppError(404, "NOTICE_ATTACHMENT_NOT_FOUND", "Notice attachment not found");
  const data = storedDocumentBuffer(notice.attachmentData);
  res.set(storedDocumentHeaders({ fileName: notice.attachmentName, mimeType: notice.attachmentMime, fileSize: data.length, fallbackName: "notice-attachment" }, "attachment")).send(data);
});
router.delete("/admin/notices/:noticeId", async (req: AuthRequest, res) => { if (!admins.includes(req.auth!.role)) throw new AppError(403, "ADMIN_REQUIRED", "Administrator access is required"); const notice = await prisma.announcement.findFirst({ where: { id: id.parse(req.params.noticeId), kind: "NOTICE" } }); if (!notice) throw new AppError(404, "NOTICE_NOT_FOUND", "Notice not found"); await requireBranch(req, notice.branchId); await prisma.$transaction([prisma.announcement.update({ where: { id: notice.id }, data: { isArchived: true } }), prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: "ARCHIVE", entity: "Notice", entityId: notice.id } })]); res.status(204).end(); });

export default router;
