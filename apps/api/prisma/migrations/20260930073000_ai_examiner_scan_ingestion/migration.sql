-- ERP/LMS 3.1A: secure OMR/barcode scan bindings and page-level ingestion records.

DO $$ BEGIN
  CREATE TYPE "AIExaminerScanBindingStatus" AS ENUM ('ACTIVE','LOCKED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIExaminerScanPageStatus" AS ENUM ('ACCEPTED','REVIEW_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AIExaminerScanBinding" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "answerSheetId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "AIExaminerScanBindingStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerScanBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIExaminerScanPage" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "totalPages" INTEGER NOT NULL,
  "scannerEngine" TEXT NOT NULL,
  "scannerVersion" TEXT NOT NULL,
  "barcodeConfidence" DECIMAL(5,4) NOT NULL,
  "imageQuality" DECIMAL(5,4) NOT NULL,
  "status" "AIExaminerScanPageStatus" NOT NULL,
  "payload" JSONB NOT NULL,
  "validationResult" JSONB NOT NULL,
  "ingestedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerScanPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerScanBinding_answerSheetId_key"
  ON "AIExaminerScanBinding"("answerSheetId");
CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerScanBinding_tokenHash_key"
  ON "AIExaminerScanBinding"("tokenHash");
CREATE INDEX IF NOT EXISTS "AIExaminerScanBinding_organizationId_status_idx"
  ON "AIExaminerScanBinding"("organizationId","status");
CREATE INDEX IF NOT EXISTS "AIExaminerScanBinding_createdById_idx"
  ON "AIExaminerScanBinding"("createdById");

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerScanPage_bindingId_pageNumber_key"
  ON "AIExaminerScanPage"("bindingId","pageNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerScanPage_organizationId_scanId_key"
  ON "AIExaminerScanPage"("organizationId","scanId");
CREATE INDEX IF NOT EXISTS "AIExaminerScanPage_organizationId_status_createdAt_idx"
  ON "AIExaminerScanPage"("organizationId","status","createdAt");
CREATE INDEX IF NOT EXISTS "AIExaminerScanPage_ingestedById_idx"
  ON "AIExaminerScanPage"("ingestedById");

DO $$ BEGIN
  ALTER TABLE "AIExaminerScanBinding"
    ADD CONSTRAINT "AIExaminerScanBinding_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerScanBinding"
    ADD CONSTRAINT "AIExaminerScanBinding_answerSheetId_fkey"
    FOREIGN KEY ("answerSheetId") REFERENCES "ExaminationAnswerSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerScanBinding"
    ADD CONSTRAINT "AIExaminerScanBinding_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerScanPage"
    ADD CONSTRAINT "AIExaminerScanPage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerScanPage"
    ADD CONSTRAINT "AIExaminerScanPage_bindingId_fkey"
    FOREIGN KEY ("bindingId") REFERENCES "AIExaminerScanBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerScanPage"
    ADD CONSTRAINT "AIExaminerScanPage_ingestedById_fkey"
    FOREIGN KEY ("ingestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
