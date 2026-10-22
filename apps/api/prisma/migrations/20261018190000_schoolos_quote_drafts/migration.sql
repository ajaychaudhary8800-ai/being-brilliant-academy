-- Additive V5 draft-only pricing records. Does not mutate SaaS plan, subscription or payments.
CREATE TABLE "SchoolOSQuotation" (
  "id" TEXT NOT NULL,
  "quoteNo" TEXT NOT NULL,
  "organizationId" TEXT,
  "clientName" TEXT NOT NULL,
  "clientEmail" TEXT,
  "planCode" TEXT NOT NULL,
  "billingCycle" "SaaSBillingCycle" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "items" JSONB NOT NULL DEFAULT '[]',
  "pricingSnapshot" JSONB NOT NULL,
  "subtotalPaise" INTEGER NOT NULL,
  "discountBps" INTEGER NOT NULL DEFAULT 0,
  "discountPaise" INTEGER NOT NULL DEFAULT 0,
  "taxRateBps" INTEGER NOT NULL,
  "taxPaise" INTEGER NOT NULL,
  "totalPaise" INTEGER NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolOSQuotation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolOSQuotation_pricing_check" CHECK ("subtotalPaise" >= 0 AND "totalPaise" >= 0 AND "discountPaise" >= 0 AND "taxPaise" >= 0 AND "discountBps" BETWEEN 0 AND 5000 AND "version" >= 1)
);
CREATE TABLE "SchoolOSQuotationRevision" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolOSQuotationRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchoolOSQuotation_quoteNo_key" ON "SchoolOSQuotation"("quoteNo");
CREATE INDEX "SchoolOSQuotation_organizationId_status_createdAt_idx" ON "SchoolOSQuotation"("organizationId", "status", "createdAt");
CREATE INDEX "SchoolOSQuotation_status_createdAt_idx" ON "SchoolOSQuotation"("status", "createdAt");
CREATE UNIQUE INDEX "SchoolOSQuotationRevision_quoteId_version_key" ON "SchoolOSQuotationRevision"("quoteId", "version");
CREATE INDEX "SchoolOSQuotationRevision_quoteId_createdAt_idx" ON "SchoolOSQuotationRevision"("quoteId", "createdAt");
ALTER TABLE "SchoolOSQuotation" ADD CONSTRAINT "SchoolOSQuotation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSQuotationRevision" ADD CONSTRAINT "SchoolOSQuotationRevision_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "SchoolOSQuotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
