-- V5 quote acceptance evidence; additive. No customer billing or pricing change.
ALTER TABLE "SchoolOSQuotation"
  ADD COLUMN "contractDocumentId" TEXT,
  ADD COLUMN "contractedAt" TIMESTAMP(3),
  ADD COLUMN "contractedBy" TEXT;
CREATE UNIQUE INDEX "SchoolOSQuotation_contractDocumentId_key"
  ON "SchoolOSQuotation"("contractDocumentId");
ALTER TABLE "SchoolOSQuotation"
  ADD CONSTRAINT "SchoolOSQuotation_contractDocumentId_fkey"
  FOREIGN KEY ("contractDocumentId") REFERENCES "SaaSCommercialDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
