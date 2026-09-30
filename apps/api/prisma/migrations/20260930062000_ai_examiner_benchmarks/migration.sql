-- ERP/LMS 3.1: auditable Ranpal AI Examiner benchmark/calibration datasets and release gates.

DO $$ BEGIN
  CREATE TYPE "AIExaminerBenchmarkSuiteStatus" AS ENUM ('DRAFT','ACTIVE','ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AIExaminerBenchmarkRunStatus" AS ENUM ('QUEUED','RUNNING','COMPLETED','FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AIExaminerBenchmarkSuite" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT,
  "subjectId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "classLevel" "ClassLevel",
  "academicBoard" "AcademicBoard",
  "questionType" "QuestionType",
  "status" "AIExaminerBenchmarkSuiteStatus" NOT NULL DEFAULT 'DRAFT',
  "thresholds" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerBenchmarkSuite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIExaminerBenchmarkCase" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "suiteId" TEXT NOT NULL,
  "sourceAnswerSheetId" TEXT,
  "questionKey" TEXT NOT NULL,
  "maxMarks" DECIMAL(8,2) NOT NULL,
  "humanMarks" DECIMAL(8,2) NOT NULL,
  "humanReviewerId" TEXT NOT NULL,
  "goldNotes" TEXT,
  "metadata" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerBenchmarkCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIExaminerBenchmarkRun" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "suiteId" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "status" "AIExaminerBenchmarkRunStatus" NOT NULL DEFAULT 'QUEUED',
  "thresholds" JSONB NOT NULL,
  "metrics" JSONB,
  "ready" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerBenchmarkRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIExaminerBenchmarkResult" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "aiMarks" DECIMAL(8,2) NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
  "teacherOverride" BOOLEAN NOT NULL DEFAULT false,
  "diagnostics" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIExaminerBenchmarkResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerBenchmarkSuite_organizationId_code_key"
  ON "AIExaminerBenchmarkSuite"("organizationId","code");
CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkSuite_organizationId_status_idx"
  ON "AIExaminerBenchmarkSuite"("organizationId","status");
CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkSuite_organizationId_subjectId_questionType_idx"
  ON "AIExaminerBenchmarkSuite"("organizationId","subjectId","questionType");
CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkSuite_organizationId_branchId_status_idx"
  ON "AIExaminerBenchmarkSuite"("organizationId","branchId","status");

CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkCase_organizationId_suiteId_isActive_idx"
  ON "AIExaminerBenchmarkCase"("organizationId","suiteId","isActive");
CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkCase_sourceAnswerSheetId_questionKey_idx"
  ON "AIExaminerBenchmarkCase"("sourceAnswerSheetId","questionKey");
CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkCase_humanReviewerId_idx"
  ON "AIExaminerBenchmarkCase"("humanReviewerId");

CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkRun_organizationId_suiteId_createdAt_idx"
  ON "AIExaminerBenchmarkRun"("organizationId","suiteId","createdAt");
CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkRun_organizationId_status_idx"
  ON "AIExaminerBenchmarkRun"("organizationId","status");

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerBenchmarkResult_runId_caseId_key"
  ON "AIExaminerBenchmarkResult"("runId","caseId");
CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkResult_organizationId_runId_idx"
  ON "AIExaminerBenchmarkResult"("organizationId","runId");
CREATE INDEX IF NOT EXISTS "AIExaminerBenchmarkResult_caseId_idx"
  ON "AIExaminerBenchmarkResult"("caseId");

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkSuite"
    ADD CONSTRAINT "AIExaminerBenchmarkSuite_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkSuite"
    ADD CONSTRAINT "AIExaminerBenchmarkSuite_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkSuite"
    ADD CONSTRAINT "AIExaminerBenchmarkSuite_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkSuite"
    ADD CONSTRAINT "AIExaminerBenchmarkSuite_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkSuite"
    ADD CONSTRAINT "AIExaminerBenchmarkSuite_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkCase"
    ADD CONSTRAINT "AIExaminerBenchmarkCase_suiteId_fkey"
    FOREIGN KEY ("suiteId") REFERENCES "AIExaminerBenchmarkSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkCase"
    ADD CONSTRAINT "AIExaminerBenchmarkCase_sourceAnswerSheetId_fkey"
    FOREIGN KEY ("sourceAnswerSheetId") REFERENCES "ExaminationAnswerSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkCase"
    ADD CONSTRAINT "AIExaminerBenchmarkCase_humanReviewerId_fkey"
    FOREIGN KEY ("humanReviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkRun"
    ADD CONSTRAINT "AIExaminerBenchmarkRun_suiteId_fkey"
    FOREIGN KEY ("suiteId") REFERENCES "AIExaminerBenchmarkSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkRun"
    ADD CONSTRAINT "AIExaminerBenchmarkRun_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkResult"
    ADD CONSTRAINT "AIExaminerBenchmarkResult_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "AIExaminerBenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerBenchmarkResult"
    ADD CONSTRAINT "AIExaminerBenchmarkResult_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "AIExaminerBenchmarkCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
