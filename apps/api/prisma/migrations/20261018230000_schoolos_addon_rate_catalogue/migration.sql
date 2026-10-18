-- V5: approval-controlled additive rate catalogue, no production rate seeding.
CREATE TABLE "SchoolOSAddonRate" (
  "id" TEXT NOT NULL, "category" TEXT NOT NULL, "code" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "label" TEXT NOT NULL, "description" TEXT,
  "unitPricePaise" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'INR',
  "taxRateBps" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3) NOT NULL, "effectiveUntil" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL, "approvedBy" TEXT, "approvedAt" TIMESTAMP(3),
  "approvalReference" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolOSAddonRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolOSAddonRate_rate_check" CHECK (
    "category" IN ('MODULE', 'CAPACITY', 'AI_USAGE', 'VIDEO_USAGE', 'IMPLEMENTATION')
    AND "unitPricePaise" > 0 AND "unitPricePaise" <= 2147483647
    AND "revision" > 0 AND "currency" = 'INR' AND "taxRateBps" BETWEEN 0 AND 10000
    AND ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
    AND "status" IN ('DRAFT', 'APPROVED')
    AND (
      ("status" = 'DRAFT' AND "approvedBy" IS NULL AND "approvedAt" IS NULL)
      OR ("status" = 'APPROVED' AND "approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL
        AND "approvalReference" IS NOT NULL AND "createdBy" <> "approvedBy")
    )
  )
);
CREATE UNIQUE INDEX "SchoolOSAddonRate_category_code_revision_key"
  ON "SchoolOSAddonRate"("category", "code", "revision");
CREATE INDEX "SchoolOSAddonRate_status_category_code_effectiveFrom_idx"
  ON "SchoolOSAddonRate"("status", "category", "code", "effectiveFrom");

-- A shared transaction-level advisory lock and overlapping-window query in the
-- approval route ensure only one active approved rate per category/code.
