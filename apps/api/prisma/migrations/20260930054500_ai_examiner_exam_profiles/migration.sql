-- ERP/LMS 3.1: tenant-scoped, versioned Ranpal AI Examiner exam profiles.
-- Existing examinations remain compatible because profile linkage is nullable.

DO $$ BEGIN
  CREATE TYPE "AIExaminerExamProfileKind" AS ENUM (
    'SCHOOL','CBSE','ICSE','ISC','JEE_MAIN','JEE_ADVANCED','NEET','NDA','CUET','INSTITUTION_DEFINED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AIExaminerExamProfileStatus" AS ENUM ('DRAFT','ACTIVE','ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AIExaminerExamProfile" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "AIExaminerExamProfileKind" NOT NULL,
  "version" TEXT NOT NULL,
  "status" "AIExaminerExamProfileStatus" NOT NULL DEFAULT 'DRAFT',
  "config" JSONB NOT NULL,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerExamProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerExamProfile_organizationId_code_version_key"
  ON "AIExaminerExamProfile"("organizationId","code","version");
CREATE INDEX IF NOT EXISTS "AIExaminerExamProfile_organizationId_status_kind_idx"
  ON "AIExaminerExamProfile"("organizationId","status","kind");
CREATE INDEX IF NOT EXISTS "AIExaminerExamProfile_organizationId_branchId_status_idx"
  ON "AIExaminerExamProfile"("organizationId","branchId","status");

DO $$ BEGIN
  ALTER TABLE "AIExaminerExamProfile"
    ADD CONSTRAINT "AIExaminerExamProfile_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerExamProfile"
    ADD CONSTRAINT "AIExaminerExamProfile_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerExamProfile"
    ADD CONSTRAINT "AIExaminerExamProfile_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerExamProfile"
    ADD CONSTRAINT "AIExaminerExamProfile_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Examination"
  ADD COLUMN IF NOT EXISTS "aiExaminerExamProfileId" TEXT,
  ADD COLUMN IF NOT EXISTS "aiExaminerExamProfileSnapshot" JSONB;

CREATE INDEX IF NOT EXISTS "Examination_organizationId_aiExaminerExamProfileId_idx"
  ON "Examination"("organizationId","aiExaminerExamProfileId");

DO $$ BEGIN
  ALTER TABLE "Examination"
    ADD CONSTRAINT "Examination_aiExaminerExamProfileId_fkey"
    FOREIGN KEY ("aiExaminerExamProfileId") REFERENCES "AIExaminerExamProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
