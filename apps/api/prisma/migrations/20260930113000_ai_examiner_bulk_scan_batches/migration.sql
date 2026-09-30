DO $$
BEGIN
  CREATE TYPE "AIExaminerScanBatchStatus" AS ENUM ('INGESTING','REVIEW_REQUIRED','ROUTED','FAILED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AIExaminerScanBatchPageStatus" AS ENUM ('ROUTED','REVIEW_REQUIRED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AIExaminerScanBatch" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "examinationId" TEXT NOT NULL,
  "externalBatchId" TEXT,
  "scannerEngine" TEXT NOT NULL,
  "scannerVersion" TEXT NOT NULL,
  "totalPages" INTEGER NOT NULL,
  "status" "AIExaminerScanBatchStatus" NOT NULL DEFAULT 'INGESTING',
  "routedPages" INTEGER NOT NULL DEFAULT 0,
  "reviewPages" INTEGER NOT NULL DEFAULT 0,
  "rejectedPages" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerScanBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIExaminerScanBatchPage" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourcePageNumber" INTEGER NOT NULL,
  "scanId" TEXT NOT NULL,
  "bindingId" TEXT,
  "answerSheetId" TEXT,
  "targetPageNumber" INTEGER,
  "targetTotalPages" INTEGER,
  "barcodeConfidence" DECIMAL(5,4) NOT NULL,
  "imageQuality" DECIMAL(5,4) NOT NULL,
  "status" "AIExaminerScanBatchPageStatus" NOT NULL,
  "issueCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "routedScanPageId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerScanBatchPage_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIExaminerScanBatch_organizationId_fkey') THEN
    ALTER TABLE "AIExaminerScanBatch" ADD CONSTRAINT "AIExaminerScanBatch_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIExaminerScanBatch_examinationId_fkey') THEN
    ALTER TABLE "AIExaminerScanBatch" ADD CONSTRAINT "AIExaminerScanBatch_examinationId_fkey"
      FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIExaminerScanBatch_createdById_fkey') THEN
    ALTER TABLE "AIExaminerScanBatch" ADD CONSTRAINT "AIExaminerScanBatch_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIExaminerScanBatchPage_organizationId_fkey') THEN
    ALTER TABLE "AIExaminerScanBatchPage" ADD CONSTRAINT "AIExaminerScanBatchPage_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIExaminerScanBatchPage_batchId_fkey') THEN
    ALTER TABLE "AIExaminerScanBatchPage" ADD CONSTRAINT "AIExaminerScanBatchPage_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "AIExaminerScanBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerScanBatch_organizationId_externalBatchId_key"
  ON "AIExaminerScanBatch"("organizationId","externalBatchId");
CREATE INDEX IF NOT EXISTS "AIExaminerScanBatch_organizationId_examinationId_status_idx"
  ON "AIExaminerScanBatch"("organizationId","examinationId","status");
CREATE INDEX IF NOT EXISTS "AIExaminerScanBatch_createdById_idx"
  ON "AIExaminerScanBatch"("createdById");

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerScanBatchPage_batchId_sourcePageNumber_key"
  ON "AIExaminerScanBatchPage"("batchId","sourcePageNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerScanBatchPage_organizationId_scanId_key"
  ON "AIExaminerScanBatchPage"("organizationId","scanId");
CREATE INDEX IF NOT EXISTS "AIExaminerScanBatchPage_organizationId_status_createdAt_idx"
  ON "AIExaminerScanBatchPage"("organizationId","status","createdAt");
CREATE INDEX IF NOT EXISTS "AIExaminerScanBatchPage_bindingId_idx"
  ON "AIExaminerScanBatchPage"("bindingId");
CREATE INDEX IF NOT EXISTS "AIExaminerScanBatchPage_answerSheetId_idx"
  ON "AIExaminerScanBatchPage"("answerSheetId");
