-- ERP/LMS 3.1A: formal regrade/appeal workflow with immutable result revisions.

DO $$ BEGIN
  CREATE TYPE "AIExaminerRegradeRequestStatus" AS ENUM (
    'REQUESTED','APPROVED','REVIEW_IN_PROGRESS','RESOLVED','REJECTED','CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIExaminerRegradeScope" AS ENUM ('WHOLE_SCRIPT','QUESTION_SET','CLERICAL_CHECK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AIExaminerRegradeRequest" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "answerSheetId" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "resultId" TEXT NOT NULL,
  "scope" "AIExaminerRegradeScope" NOT NULL DEFAULT 'WHOLE_SCRIPT',
  "questionKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reason" TEXT NOT NULL,
  "status" "AIExaminerRegradeRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "originalMarks" DECIMAL(8,2) NOT NULL,
  "requestedById" TEXT NOT NULL,
  "decidedById" TEXT,
  "decisionNotes" TEXT,
  "decidedAt" TIMESTAMP(3),
  "reviewRoundId" TEXT,
  "resolvedMarks" DECIMAL(8,2),
  "resolvedById" TEXT,
  "resolutionNotes" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerRegradeRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIExaminerResultRevision" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "resultId" TEXT NOT NULL,
  "regradeRequestId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "beforeSnapshot" JSONB NOT NULL,
  "afterSnapshot" JSONB NOT NULL,
  "changedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIExaminerResultRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerRegradeRequest_reviewRoundId_key"
  ON "AIExaminerRegradeRequest"("reviewRoundId");
CREATE INDEX IF NOT EXISTS "AIExaminerRegradeRequest_organizationId_status_createdAt_idx"
  ON "AIExaminerRegradeRequest"("organizationId","status","createdAt");
CREATE INDEX IF NOT EXISTS "AIExaminerRegradeRequest_organizationId_answerSheetId_status_idx"
  ON "AIExaminerRegradeRequest"("organizationId","answerSheetId","status");
CREATE INDEX IF NOT EXISTS "AIExaminerRegradeRequest_evaluationId_idx"
  ON "AIExaminerRegradeRequest"("evaluationId");
CREATE INDEX IF NOT EXISTS "AIExaminerRegradeRequest_resultId_idx"
  ON "AIExaminerRegradeRequest"("resultId");
CREATE INDEX IF NOT EXISTS "AIExaminerRegradeRequest_requestedById_idx"
  ON "AIExaminerRegradeRequest"("requestedById");

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerResultRevision_regradeRequestId_key"
  ON "AIExaminerResultRevision"("regradeRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerResultRevision_resultId_revision_key"
  ON "AIExaminerResultRevision"("resultId","revision");
CREATE INDEX IF NOT EXISTS "AIExaminerResultRevision_organizationId_resultId_createdAt_idx"
  ON "AIExaminerResultRevision"("organizationId","resultId","createdAt");
CREATE INDEX IF NOT EXISTS "AIExaminerResultRevision_changedById_idx"
  ON "AIExaminerResultRevision"("changedById");

DO $$ BEGIN
  ALTER TABLE "AIExaminerRegradeRequest"
    ADD CONSTRAINT "AIExaminerRegradeRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerRegradeRequest"
    ADD CONSTRAINT "AIExaminerRegradeRequest_answerSheetId_fkey"
    FOREIGN KEY ("answerSheetId") REFERENCES "ExaminationAnswerSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerRegradeRequest"
    ADD CONSTRAINT "AIExaminerRegradeRequest_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "AIExaminerEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerRegradeRequest"
    ADD CONSTRAINT "AIExaminerRegradeRequest_resultId_fkey"
    FOREIGN KEY ("resultId") REFERENCES "ExaminationResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerRegradeRequest"
    ADD CONSTRAINT "AIExaminerRegradeRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerRegradeRequest"
    ADD CONSTRAINT "AIExaminerRegradeRequest_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerRegradeRequest"
    ADD CONSTRAINT "AIExaminerRegradeRequest_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerRegradeRequest"
    ADD CONSTRAINT "AIExaminerRegradeRequest_reviewRoundId_fkey"
    FOREIGN KEY ("reviewRoundId") REFERENCES "AIExaminerReviewRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerResultRevision"
    ADD CONSTRAINT "AIExaminerResultRevision_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerResultRevision"
    ADD CONSTRAINT "AIExaminerResultRevision_resultId_fkey"
    FOREIGN KEY ("resultId") REFERENCES "ExaminationResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerResultRevision"
    ADD CONSTRAINT "AIExaminerResultRevision_regradeRequestId_fkey"
    FOREIGN KEY ("regradeRequestId") REFERENCES "AIExaminerRegradeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerResultRevision"
    ADD CONSTRAINT "AIExaminerResultRevision_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
