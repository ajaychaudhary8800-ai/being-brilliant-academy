-- Fail-closed SchoolOS add-on payment holds for processed refunds and new disputes.
-- Records are additive; subscription financial status and historical usage events remain unchanged.
CREATE TABLE "SchoolOSPaymentRiskHold" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "firstEventType" TEXT NOT NULL,
  "latestEventType" TEXT NOT NULL,
  "firstEventKey" TEXT NOT NULL,
  "latestEventKey" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolOSPaymentRiskHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolOSPaymentRiskHold_active_check" CHECK ("status" = 'ACTIVE')
);
CREATE TABLE "SchoolOSPaymentAdjustment" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "providerEntityId" TEXT NOT NULL,
  "providerPaymentId" TEXT NOT NULL,
  "amountPaise" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolOSPaymentAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolOSPaymentAdjustment_valid_check" CHECK (
    "eventType" IN ('refund.processed', 'payment.dispute.created', 'payment.dispute.lost')
    AND "amountPaise" > 0 AND "currency" = 'INR'
  )
);
CREATE UNIQUE INDEX "SchoolOSPaymentRiskHold_invoiceId_key" ON "SchoolOSPaymentRiskHold"("invoiceId");
CREATE INDEX "SchoolOSPaymentRiskHold_organizationId_status_idx" ON "SchoolOSPaymentRiskHold"("organizationId", "status");
CREATE UNIQUE INDEX "SchoolOSPaymentAdjustment_eventKey_key" ON "SchoolOSPaymentAdjustment"("eventKey");
CREATE UNIQUE INDEX "SchoolOSPaymentAdjustment_eventType_providerEntityId_key" ON "SchoolOSPaymentAdjustment"("eventType", "providerEntityId");
CREATE INDEX "SchoolOSPaymentAdjustment_organizationId_createdAt_idx" ON "SchoolOSPaymentAdjustment"("organizationId", "createdAt");
ALTER TABLE "SchoolOSPaymentRiskHold" ADD CONSTRAINT "SchoolOSPaymentRiskHold_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "SaaSInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSPaymentRiskHold" ADD CONSTRAINT "SchoolOSPaymentRiskHold_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSPaymentAdjustment" ADD CONSTRAINT "SchoolOSPaymentAdjustment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "SaaSInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSPaymentAdjustment" ADD CONSTRAINT "SchoolOSPaymentAdjustment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every hold/adjustment must match its original invoice tenant and have a PAID source invoice.
CREATE OR REPLACE FUNCTION schoolos_payment_risk_tenant_guard_fn()
RETURNS TRIGGER AS $$
DECLARE original_tenant TEXT;
DECLARE original_status TEXT;
BEGIN
  SELECT "organizationId", "status"::TEXT INTO original_tenant, original_status
    FROM "SaaSInvoice" WHERE "id"=NEW."invoiceId";
  IF original_tenant IS NULL OR original_tenant <> NEW."organizationId" OR original_status <> 'PAID' THEN
    RAISE EXCEPTION 'SCHOOLOS_RISK_SOURCE_TENANT_OR_PAYMENT_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SchoolOSPaymentRiskHold_tenant_guard"
  BEFORE INSERT OR UPDATE ON "SchoolOSPaymentRiskHold"
  FOR EACH ROW EXECUTE FUNCTION schoolos_payment_risk_tenant_guard_fn();
CREATE TRIGGER "SchoolOSPaymentAdjustment_tenant_guard"
  BEFORE INSERT OR UPDATE ON "SchoolOSPaymentAdjustment"
  FOR EACH ROW EXECUTE FUNCTION schoolos_payment_risk_tenant_guard_fn();
