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

-- Close direct-SQL minting gaps: a PAID invoice with an active hold is no
-- longer valid new license or prepaid credit-grant evidence.
CREATE OR REPLACE FUNCTION schoolos_license_paid_guard_fn()
RETURNS TRIGGER AS $$
DECLARE original_tenant TEXT;
DECLARE original_status TEXT;
DECLARE original_quote TEXT;
BEGIN
  SELECT "organizationId", "status"::TEXT, "schoolOSQuoteId"
    INTO original_tenant, original_status, original_quote
    FROM "SaaSInvoice" WHERE "id" = NEW."invoiceId";
  IF original_tenant IS NULL OR original_tenant <> NEW."organizationId"
    OR original_status <> 'PAID' OR original_quote IS NULL
    OR original_quote <> NEW."quoteId"
    OR EXISTS (SELECT 1 FROM "SchoolOSPaymentRiskHold" WHERE "invoiceId"=NEW."invoiceId" AND "status"='ACTIVE') THEN
    RAISE EXCEPTION 'SCHOOLOS_LICENSE_PAID_INVOICE_NOT_CLEAR' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION schoolos_usage_event_tenant_guard_fn()
RETURNS TRIGGER AS $$
DECLARE balance_tenant TEXT;
DECLARE balance_metric TEXT;
DECLARE invoice_tenant TEXT;
DECLARE invoice_status TEXT;
BEGIN
  SELECT "organizationId", "metric" INTO balance_tenant, balance_metric
    FROM "SchoolOSUsageBalance" WHERE "id"=NEW."balanceId";
  IF balance_tenant IS NULL OR balance_tenant <> NEW."organizationId"
    OR balance_metric <> NEW."metric" THEN
    RAISE EXCEPTION 'SCHOOLOS_USAGE_TENANT_OR_METRIC_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF NEW."kind"='GRANT' THEN
    SELECT "organizationId", "status"::TEXT INTO invoice_tenant, invoice_status
      FROM "SaaSInvoice" WHERE "id"=NEW."sourceInvoiceId";
    IF invoice_tenant IS NULL OR invoice_tenant <> NEW."organizationId"
      OR invoice_status <> 'PAID'
      OR EXISTS (SELECT 1 FROM "SchoolOSPaymentRiskHold" WHERE "invoiceId"=NEW."sourceInvoiceId" AND "status"='ACTIVE') THEN
      RAISE EXCEPTION 'SCHOOLOS_USAGE_UNPAID_FOREIGN_OR_HELD_INVOICE' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
