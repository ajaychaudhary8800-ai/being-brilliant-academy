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
