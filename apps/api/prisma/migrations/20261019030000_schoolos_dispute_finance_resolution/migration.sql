-- Stage 7D2: finance-controlled review. Preserve all historical risk adjustments.
ALTER TABLE "SchoolOSPaymentRiskHold" DROP CONSTRAINT "SchoolOSPaymentRiskHold_active_check";
ALTER TABLE "SchoolOSPaymentRiskHold"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedBy" TEXT,
  ADD COLUMN "resolutionReference" TEXT;
ALTER TABLE "SchoolOSPaymentRiskHold" ADD CONSTRAINT "SchoolOSPaymentRiskHold_state_check"
  CHECK (
    "revision" > 0 AND (
      ("status"='ACTIVE' AND "resolvedAt" IS NULL AND "resolvedBy" IS NULL AND "resolutionReference" IS NULL)
      OR ("status"='RESOLVED' AND "resolvedAt" IS NOT NULL
        AND "resolvedBy" IS NOT NULL AND "resolutionReference" IS NOT NULL)
    )
  );
CREATE TABLE "SchoolOSPaymentRiskReview" (
  "id" TEXT NOT NULL, "invoiceId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "riskRevision" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "evidenceReference" TEXT NOT NULL, "rationale" TEXT NOT NULL,
  "proposedBy" TEXT NOT NULL, "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "reviewComment" TEXT,
  CONSTRAINT "SchoolOSPaymentRiskReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolOSPaymentRiskReview_state_check" CHECK (
    "riskRevision" > 0 AND "status" IN ('PENDING','APPROVED','REJECTED')
    AND char_length("evidenceReference") >= 12
    AND char_length("rationale") >= 20
    AND (("status"='PENDING' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL)
      OR ("status" <> 'PENDING' AND "reviewedBy" IS NOT NULL
        AND "reviewedAt" IS NOT NULL AND "reviewedBy" <> "proposedBy"))
  )
);
CREATE UNIQUE INDEX "SchoolOSPaymentRiskReview_invoiceId_riskRevision_key"
  ON "SchoolOSPaymentRiskReview"("invoiceId","riskRevision");
CREATE INDEX "SchoolOSPaymentRiskReview_organizationId_status_idx"
  ON "SchoolOSPaymentRiskReview"("organizationId","status");
ALTER TABLE "SchoolOSPaymentRiskReview" ADD CONSTRAINT "SchoolOSPaymentRiskReview_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "SaaSInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSPaymentRiskReview" ADD CONSTRAINT "SchoolOSPaymentRiskReview_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE OR REPLACE TRIGGER "SchoolOSPaymentRiskReview_tenant_guard"
  BEFORE INSERT OR UPDATE ON "SchoolOSPaymentRiskReview"
  FOR EACH ROW EXECUTE FUNCTION schoolos_payment_risk_tenant_guard_fn();
ALTER TABLE "SchoolOSPaymentAdjustment" DROP CONSTRAINT "SchoolOSPaymentAdjustment_valid_check";
ALTER TABLE "SchoolOSPaymentAdjustment" ADD CONSTRAINT "SchoolOSPaymentAdjustment_valid_check"
  CHECK ("eventType" IN ('refund.processed','payment.dispute.created','payment.dispute.lost','payment.dispute.won')
    AND "amountPaise" > 0 AND "currency"='INR');
