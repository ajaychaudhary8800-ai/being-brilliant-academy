-- ERP/LMS 3.1A: persistent human-review rounds for blind, double-blind, committee and moderation workflows.

DO $$ BEGIN
  CREATE TYPE "AIExaminerReviewMode" AS ENUM ('STANDARD','BLIND','DOUBLE_BLIND','COMMITTEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIExaminerReviewRoundKind" AS ENUM ('PRIMARY','SECONDARY','MODERATION','APPEAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AIExaminerReviewRoundStatus" AS ENUM ('ASSIGNED','IN_PROGRESS','SUBMITTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AIExaminerReviewRound" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" "AIExaminerReviewRoundKind" NOT NULL DEFAULT 'PRIMARY',
  "mode" "AIExaminerReviewMode" NOT NULL DEFAULT 'STANDARD',
  "reviewerId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "anonymizeStudentIdentity" BOOLEAN NOT NULL DEFAULT false,
  "sourceIdentityMasked" BOOLEAN NOT NULL DEFAULT false,
  "priorMarksVisible" BOOLEAN NOT NULL DEFAULT true,
  "status" "AIExaminerReviewRoundStatus" NOT NULL DEFAULT 'ASSIGNED',
  "totalMarks" DECIMAL(8,2),
  "notes" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerReviewRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIExaminerReviewDecision" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "reviewRoundId" TEXT NOT NULL,
  "questionEvaluationId" TEXT NOT NULL,
  "questionKey" TEXT NOT NULL,
  "awardedMarks" DECIMAL(8,2) NOT NULL,
  "comment" TEXT,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerReviewDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerReviewRound_evaluationId_sequence_key"
  ON "AIExaminerReviewRound"("evaluationId","sequence");
CREATE INDEX IF NOT EXISTS "AIExaminerReviewRound_organizationId_reviewerId_status_idx"
  ON "AIExaminerReviewRound"("organizationId","reviewerId","status");
CREATE INDEX IF NOT EXISTS "AIExaminerReviewRound_organizationId_evaluationId_status_idx"
  ON "AIExaminerReviewRound"("organizationId","evaluationId","status");

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerReviewDecision_reviewRoundId_questionEvaluationId_key"
  ON "AIExaminerReviewDecision"("reviewRoundId","questionEvaluationId");
CREATE INDEX IF NOT EXISTS "AIExaminerReviewDecision_organizationId_reviewRoundId_idx"
  ON "AIExaminerReviewDecision"("organizationId","reviewRoundId");
CREATE INDEX IF NOT EXISTS "AIExaminerReviewDecision_questionEvaluationId_idx"
  ON "AIExaminerReviewDecision"("questionEvaluationId");

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewRound"
    ADD CONSTRAINT "AIExaminerReviewRound_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewRound"
    ADD CONSTRAINT "AIExaminerReviewRound_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "AIExaminerEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewRound"
    ADD CONSTRAINT "AIExaminerReviewRound_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewRound"
    ADD CONSTRAINT "AIExaminerReviewRound_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewDecision"
    ADD CONSTRAINT "AIExaminerReviewDecision_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewDecision"
    ADD CONSTRAINT "AIExaminerReviewDecision_reviewRoundId_fkey"
    FOREIGN KEY ("reviewRoundId") REFERENCES "AIExaminerReviewRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewDecision"
    ADD CONSTRAINT "AIExaminerReviewDecision_questionEvaluationId_fkey"
    FOREIGN KEY ("questionEvaluationId") REFERENCES "AIExaminerQuestionEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
