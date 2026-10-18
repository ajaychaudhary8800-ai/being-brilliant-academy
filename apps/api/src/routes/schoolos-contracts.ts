import { Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { reconcileSchoolOSPricing, schoolOSExternalQuoteReady } from "../lib/schoolos-pricing-reconciliation.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
function platformOnly(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default")
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
}
const contractInput = z.object({
  expectedVersion: z.number().int().positive(),
  documentId: z.string().min(2).max(100),
  confirmedQuoteNo: z.string().min(5).max(80),
  confirmedTotalPaise: z.number().int().nonnegative(),
  approvalNotes: z.string().trim().min(20).max(1500),
}).strict();

/**
 * Binding *verified* signed acceptance only; never performs subscription, invoice,
 * checkout, provider payment or feature-entitlement mutations.
 */
router.post("/platform/schoolos/contracts/quotes/:quoteId/bind", async (req: AuthRequest, res) => {
  platformOnly(req);
  const input = contractInput.parse(req.body);
  const quoteId = String(req.params.quoteId);

  const contracted = await systemPrisma.$transaction(async tx => {
    const quote = await tx.schoolOSQuotation.findUnique({ where: { id: quoteId } });
    if (!quote) throw new AppError(404, "SCHOOLOS_QUOTE_NOT_FOUND", "Quotation not found");
    if (quote.version !== input.expectedVersion || quote.status !== "INTERNALLY_APPROVED")
      throw new AppError(409, "SCHOOLOS_QUOTE_VERSION_CONFLICT", "Quotation is not currently approved at this version");
    if (!quote.organizationId)
      throw new AppError(422, "SCHOOLOS_CLIENT_REQUIRED", "Link a customer organization before contract binding");
    if (quote.quoteNo !== input.confirmedQuoteNo || quote.totalPaise !== input.confirmedTotalPaise)
      throw new AppError(422, "SCHOOLOS_CONTRACT_TOTAL_MISMATCH", "The confirmed order reference and signed amount must match this quotation");

    const plan = await tx.saaSPlan.findUnique({ where: { code: quote.planCode } });
    const pricing = reconcileSchoolOSPricing(quote.planCode, plan);
    const readiness = schoolOSExternalQuoteReady({
      quoteStatus: quote.status, validUntil: quote.validUntil, clientOrganizationId: quote.organizationId,
      planResult: pricing,
    });
    if (!readiness.commercialReviewReady || quote.billingCycle !== "ANNUAL")
      throw new AppError(409, "SCHOOLOS_COMMERCIAL_REVIEW_REQUIRED", "Quote is expired, annual pricing is not reconciled or approval is incomplete");

    const snapshot = quote.pricingSnapshot && typeof quote.pricingSnapshot === "object" && !Array.isArray(quote.pricingSnapshot)
      ? quote.pricingSnapshot as Record<string, any> : {};
    const rate = snapshot.rateCardSnapshot;
    if (!rate || rate.planId !== plan?.id || rate.annualPricePaise !== undefined
      || rate.basePricePaise !== plan.annualPricePaise || rate.taxRateBps !== plan.taxRateBps)
      throw new AppError(409, "SCHOOLOS_QUOTE_PRICE_CHANGED", "Plan pricing changed since quote preparation; create a new approved quote");

    const organization = await tx.organization.findUnique({ where: { id: quote.organizationId }, select: { deletedAt: true, isActive: true } });
    if (!organization || organization.deletedAt || !organization.isActive)
      throw new AppError(409, "SCHOOLOS_CLIENT_INACTIVE", "The contracted customer tenant must be active");

    const document = await tx.saaSCommercialDocument.findUnique({
      where: { id: input.documentId }, include: { lead: { select: { wonOrganizationId: true } } },
    });
    if (!document || document.archivedAt || document.verificationStatus !== "VERIFIED" || !document.signedAt || !document.verifiedAt
      || !document.verifiedById || document.uploadedById === document.verifiedById
      || document.documentType !== "SIGNED_ORDER_FORM")
      throw new AppError(422, "SCHOOLOS_SIGNED_ORDER_NOT_VERIFIED", "An independently verified, unarchived signed Order Form is required");
    if (document.documentReference !== quote.quoteNo || document.organizationId && document.organizationId !== quote.organizationId
      || document.lead.wonOrganizationId !== quote.organizationId)
      throw new AppError(422, "SCHOOLOS_ORDER_CLIENT_MISMATCH", "Signed Order Form reference or customer organization does not match the approved quote");
    if (document.signedAt > new Date() || document.signedAt < quote.createdAt || document.signedAt > quote.validUntil)
      throw new AppError(422, "SCHOOLOS_ORDER_SIGNATURE_DATE_INVALID", "Signed Order Form date must follow quotation creation and precede expiry");

    const updated = await tx.schoolOSQuotation.updateMany({
      where: { id: quote.id, status: "INTERNALLY_APPROVED", version: input.expectedVersion, contractDocumentId: null },
      data: {
        status: "CONTRACTED", version: { increment: 1 },
        contractDocumentId: document.id, contractedAt: new Date(), contractedBy: req.auth!.userId,
        updatedBy: req.auth!.userId,
      },
    });
    if (updated.count !== 1)
      throw new AppError(409, "SCHOOLOS_QUOTE_BIND_CONFLICT", "Quote has already been changed or contracted");
    const saved = await tx.schoolOSQuotation.findUniqueOrThrow({ where: { id: quote.id } });
    await tx.schoolOSQuotationRevision.create({
      data: {
        quoteId: quote.id, version: saved.version, action: "VERIFIED_ORDER_BOUND", actorId: req.auth!.userId,
        snapshot: {
          documentId: document.id, contentSha256: document.contentSha256, signedAt: document.signedAt.toISOString(),
          verifiedAt: document.verifiedAt.toISOString(), verifiedById: document.verifiedById,
          reference: document.documentReference, totalPaise: saved.totalPaise, approvalNotes: input.approvalNotes,
        } as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: quote.organizationId, actorId: req.auth!.userId, action: "SCHOOLOS_VERIFIED_ORDER_BOUND",
        entity: "SchoolOSQuotation", entityId: quote.id,
        metadata: { quoteNo: quote.quoteNo, documentId: document.id, totalPaise: quote.totalPaise, approvalNotes: input.approvalNotes },
      },
    });
    return saved;
  });
  res.json({ data: { quoteId: contracted.id, version: contracted.version, status: contracted.status,
    documentId: contracted.contractDocumentId, paymentCollected: false, subscriptionActivated: false } });
});

router.get("/platform/schoolos/contracts/quotes/:quoteId", async (req: AuthRequest, res) => {
  platformOnly(req);
  const quote = await systemPrisma.schoolOSQuotation.findUnique({
    where: { id: String(req.params.quoteId) },
    select: { id: true, quoteNo: true, status: true, totalPaise: true, organizationId: true,
      contractDocumentId: true, contractedAt: true, contractedBy: true, version: true },
  });
  if (!quote) throw new AppError(404, "SCHOOLOS_QUOTE_NOT_FOUND", "Quotation not found");
  const document = quote.contractDocumentId ? await systemPrisma.saaSCommercialDocument.findUnique({
    where: { id: quote.contractDocumentId },
    select: { documentType: true, verificationStatus: true, contentSha256: true, archivedAt: true, signedAt: true, verifiedAt: true },
  }) : null;
  res.json({ data: { ...quote, document, currentEvidenceVerified: Boolean(document && !document.archivedAt && document.verificationStatus === "VERIFIED"),
    subscriptionActivated: false } });
});
export default router;
