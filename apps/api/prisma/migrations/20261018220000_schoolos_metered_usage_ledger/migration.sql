-- V5 Stage 7: auditable metered add-on ledger; does not auto-issue credits.
CREATE TABLE "SchoolOSUsageBalance" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "grantedUnits" INTEGER NOT NULL DEFAULT 0,
  "consumedUnits" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolOSUsageBalance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolOSUsageBalance_safe_units_check" CHECK (
    "grantedUnits" >= 0 AND "consumedUnits" >= 0 AND "consumedUnits" <= "grantedUnits"
    AND "periodEnd" > "periodStart" AND "metric" IN ('ai_credits', 'video_minutes')
  )
);
CREATE TABLE "SchoolOSUsageEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "balanceId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "units" INTEGER NOT NULL,
  "requestKey" TEXT NOT NULL,
  "sourceInvoiceId" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolOSUsageEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolOSUsageEvent_valid_check" CHECK (
    "units" > 0 AND "metric" IN ('ai_credits', 'video_minutes')
    AND (("kind" = 'GRANT' AND "sourceInvoiceId" IS NOT NULL)
      OR ("kind" = 'CONSUME' AND "sourceInvoiceId" IS NULL))
  )
);
CREATE UNIQUE INDEX "SchoolOSUsageBalance_organizationId_metric_periodStart_key"
  ON "SchoolOSUsageBalance"("organizationId", "metric", "periodStart");
CREATE INDEX "SchoolOSUsageBalance_organizationId_metric_periodEnd_idx"
  ON "SchoolOSUsageBalance"("organizationId", "metric", "periodEnd");
CREATE UNIQUE INDEX "SchoolOSUsageEvent_organizationId_metric_requestKey_key"
  ON "SchoolOSUsageEvent"("organizationId", "metric", "requestKey");
CREATE INDEX "SchoolOSUsageEvent_organizationId_createdAt_idx"
  ON "SchoolOSUsageEvent"("organizationId", "createdAt");
CREATE INDEX "SchoolOSUsageEvent_balanceId_kind_idx"
  ON "SchoolOSUsageEvent"("balanceId", "kind");
CREATE INDEX "SchoolOSUsageEvent_sourceInvoiceId_idx"
  ON "SchoolOSUsageEvent"("sourceInvoiceId");
ALTER TABLE "SchoolOSUsageBalance" ADD CONSTRAINT "SchoolOSUsageBalance_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSUsageEvent" ADD CONSTRAINT "SchoolOSUsageEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSUsageEvent" ADD CONSTRAINT "SchoolOSUsageEvent_balanceId_fkey"
  FOREIGN KEY ("balanceId") REFERENCES "SchoolOSUsageBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSUsageEvent" ADD CONSTRAINT "SchoolOSUsageEvent_sourceInvoiceId_fkey"
  FOREIGN KEY ("sourceInvoiceId") REFERENCES "SaaSInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reject tenant/metric misassociation even if an ORM bypasses application checks.
CREATE OR REPLACE FUNCTION schoolos_usage_event_tenant_guard_fn()
RETURNS TRIGGER AS $$
DECLARE balance_tenant TEXT;
DECLARE balance_metric TEXT;
DECLARE invoice_tenant TEXT;
DECLARE invoice_status TEXT;
BEGIN
  SELECT "organizationId", "metric" INTO balance_tenant, balance_metric
    FROM "SchoolOSUsageBalance" WHERE "id" = NEW."balanceId";
  IF balance_tenant IS NULL OR balance_tenant <> NEW."organizationId"
    OR balance_metric <> NEW."metric" THEN
    RAISE EXCEPTION 'SCHOOLOS_USAGE_TENANT_OR_METRIC_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'GRANT' THEN
    SELECT "organizationId", "status"::TEXT INTO invoice_tenant, invoice_status
      FROM "SaaSInvoice" WHERE "id" = NEW."sourceInvoiceId";
    IF invoice_tenant IS NULL OR invoice_tenant <> NEW."organizationId" OR invoice_status <> 'PAID' THEN
      RAISE EXCEPTION 'SCHOOLOS_USAGE_UNPAID_OR_FOREIGN_INVOICE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SchoolOSUsageEvent_tenant_guard"
BEFORE INSERT OR UPDATE ON "SchoolOSUsageEvent"
FOR EACH ROW EXECUTE FUNCTION schoolos_usage_event_tenant_guard_fn();
