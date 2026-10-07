import crypto from "node:crypto";
import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { commercialDocumentEncryptionReady, decryptCommercialDocument, encryptCommercialDocument } from "../lib/commercial-document-crypto.js";
import { systemPrisma } from "../lib/prisma.js";
import { storedDocumentHeaders } from "../lib/secure-download.js";
import { assertDocumentFileExtension, decodeVerifiedUpload } from "../lib/secure-upload.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
const documentTypes = [
  "SIGNED_ORDER_FORM",
  "SIGNED_SAAS_AGREEMENT",
  "SIGNED_SOW",
  "SIGNED_DPA",
  "INVOICE",
  "PAYMENT_EVIDENCE",
  "UAT_ACCEPTANCE",
  "HANDOVER_ACCEPTANCE",
  "OTHER",
] as const;

function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

router.use(requireAuth);

router.get("/platform/commercial-documents", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const q = z.object({
    leadId: z.string().cuid().optional(),
    includeArchived: z.enum(["true", "false"]).optional().transform(value => value === "true"),
  }).parse(req.query);
  const rows = await systemPrisma.saaSCommercialDocument.findMany({
    where: {
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      leadId: true,
      organizationId: true,
      documentType: true,
      documentReference: true,
      signedAt: true,
      notes: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      contentSha256: true,
      verificationStatus: true,
      verificationNotes: true,
      uploadedById: true,
      verifiedById: true,
      verifiedAt: true,
      archivedById: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      lead: {
        select: {
          id: true,
          organizationName: true,
          status: true,
          wonOrganizationId: true,
        },
      },
    },
  });
  res.json({
    data: rows.map(row => ({
      ...row,
      linkedOrganizationId: row.organizationId ?? row.lead.wonOrganizationId ?? null,
    })),
    meta: { encryptionReady: commercialDocumentEncryptionReady() },
  });
});

router.post("/platform/commercial-documents", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const input = z.object({
    leadId: z.string().cuid(),
    documentType: z.enum(documentTypes),
    documentReference: z.string().trim().min(2).max(160),
    signedAt: z.coerce.date().optional(),
    notes: z.string().trim().max(4000).optional(),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.literal("application/pdf"),
    base64: z.string().min(1),
  }).parse(req.body);

  const lead = await systemPrisma.saaSSalesLead.findUnique({
    where: { id: input.leadId },
    select: { id: true, wonOrganizationId: true },
  });
  if (!lead) throw new AppError(404, "SAAS_SALES_LEAD_NOT_FOUND", "SaaS Sales lead not found");

  assertDocumentFileExtension(input.fileName, input.mimeType);
  const bytes = decodeVerifiedUpload(input.base64, input.mimeType, 10 * 1024 * 1024);
  const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const duplicate = await systemPrisma.saaSCommercialDocument.findFirst({
    where: { leadId: lead.id, contentSha256, archivedAt: null },
    select: { id: true },
  });
  if (duplicate) throw new AppError(409, "COMMERCIAL_DOCUMENT_DUPLICATE", "This document is already stored for the selected client lead");

  const created = await systemPrisma.saaSCommercialDocument.create({
    data: {
      leadId: lead.id,
      organizationId: lead.wonOrganizationId,
      documentType: input.documentType,
      documentReference: input.documentReference,
      signedAt: input.signedAt,
      notes: input.notes,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: bytes.length,
      encryptedFileData: encryptCommercialDocument(bytes),
      contentSha256,
      uploadedById: req.auth!.userId,
    },
    select: {
      id: true,
      leadId: true,
      organizationId: true,
      documentType: true,
      documentReference: true,
      signedAt: true,
      notes: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      contentSha256: true,
      verificationStatus: true,
      verificationNotes: true,
      uploadedById: true,
      verifiedById: true,
      verifiedAt: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  res.status(201).json({ data: created });
});

router.get("/platform/commercial-documents/:id/download", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const row = await systemPrisma.saaSCommercialDocument.findUnique({ where: { id: String(req.params.id) } });
  if (!row || row.archivedAt) throw new AppError(404, "COMMERCIAL_DOCUMENT_NOT_FOUND", "Commercial document not found");
  const bytes = decryptCommercialDocument(row.encryptedFileData);
  const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (contentSha256 !== row.contentSha256) throw new AppError(500, "COMMERCIAL_DOCUMENT_INTEGRITY_FAILED", "Stored commercial document failed integrity verification");
  res.set(storedDocumentHeaders({
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: bytes.length,
    fallbackName: "commercial-document",
  }, "attachment"));
  res.setHeader("Cache-Control", "no-store");
  res.send(bytes);
});

router.patch("/platform/commercial-documents/:id/verification", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const input = z.object({
    verificationStatus: z.enum(["VERIFIED", "REJECTED"]),
    verificationNotes: z.string().trim().max(4000).optional(),
  }).parse(req.body);
  const existing = await systemPrisma.saaSCommercialDocument.findUnique({
    where: { id: String(req.params.id) },
    select: { id: true, archivedAt: true },
  });
  if (!existing || existing.archivedAt) throw new AppError(404, "COMMERCIAL_DOCUMENT_NOT_FOUND", "Commercial document not found");
  const updated = await systemPrisma.saaSCommercialDocument.update({
    where: { id: existing.id },
    data: {
      verificationStatus: input.verificationStatus,
      verificationNotes: input.verificationNotes,
      verifiedById: req.auth!.userId,
      verifiedAt: new Date(),
    },
    select: {
      id: true,
      verificationStatus: true,
      verificationNotes: true,
      verifiedById: true,
      verifiedAt: true,
      updatedAt: true,
    },
  });
  res.json({ data: updated });
});

router.post("/platform/commercial-documents/:id/archive", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const existing = await systemPrisma.saaSCommercialDocument.findUnique({
    where: { id: String(req.params.id) },
    select: { id: true, archivedAt: true },
  });
  if (!existing) throw new AppError(404, "COMMERCIAL_DOCUMENT_NOT_FOUND", "Commercial document not found");
  if (existing.archivedAt) return res.status(204).end();
  await systemPrisma.saaSCommercialDocument.update({
    where: { id: existing.id },
    data: { archivedAt: new Date(), archivedById: req.auth!.userId },
  });
  res.status(204).end();
});

export default router;
