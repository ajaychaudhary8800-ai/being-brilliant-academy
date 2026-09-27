CREATE TYPE "AIExaminerRubricStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "AIExaminerEvaluationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'REVIEW_REQUIRED', 'APPROVED', 'FAILED', 'CANCELLED');

CREATE TABLE "AIExaminerRubric" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "examinationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "AIExaminerRubricStatus" NOT NULL DEFAULT 'DRAFT',
  "instructions" TEXT,
  "rubric" JSONB NOT NULL,
  "modelAnswer" JSONB,
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerRubric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIExaminerEvaluation" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "answerSheetId" TEXT NOT NULL,
  "rubricId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "AIExaminerEvaluationStatus" NOT NULL DEFAULT 'QUEUED',
  "engineVersion" TEXT NOT NULL DEFAULT 'v1',
  "provider" TEXT,
  "model" TEXT,
  "extractedText" TEXT,
  "suggestedMarks" DECIMAL(8,2),
  "confidence" DECIMAL(5,4),
  "feedback" TEXT,
  "diagnostics" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIExaminerQuestionEvaluation" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "questionKey" TEXT NOT NULL,
  "maxMarks" DECIMAL(8,2) NOT NULL,
  "suggestedMarks" DECIMAL(8,2),
  "finalMarks" DECIMAL(8,2),
  "confidence" DECIMAL(5,4),
  "rubricBreakdown" JSONB,
  "feedback" TEXT,
  "extractedAnswer" TEXT,
  "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
  "teacherComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerQuestionEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AIExaminerRubric_examinationId_version_key" ON "AIExaminerRubric"("examinationId", "version");
CREATE INDEX "AIExaminerRubric_organizationId_status_idx" ON "AIExaminerRubric"("organizationId", "status");

CREATE UNIQUE INDEX "AIExaminerEvaluation_answerSheetId_revision_key" ON "AIExaminerEvaluation"("answerSheetId", "revision");
CREATE INDEX "AIExaminerEvaluation_organizationId_status_createdAt_idx" ON "AIExaminerEvaluation"("organizationId", "status", "createdAt");
CREATE INDEX "AIExaminerEvaluation_rubricId_idx" ON "AIExaminerEvaluation"("rubricId");

CREATE UNIQUE INDEX "AIExaminerQuestionEvaluation_evaluationId_questionKey_key" ON "AIExaminerQuestionEvaluation"("evaluationId", "questionKey");
CREATE INDEX "AIExaminerQuestionEvaluation_organizationId_reviewRequired_idx" ON "AIExaminerQuestionEvaluation"("organizationId", "reviewRequired");

ALTER TABLE "AIExaminerRubric"
  ADD CONSTRAINT "AIExaminerRubric_examinationId_fkey"
  FOREIGN KEY ("examinationId") REFERENCES "Examination"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AIExaminerRubric"
  ADD CONSTRAINT "AIExaminerRubric_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AIExaminerRubric"
  ADD CONSTRAINT "AIExaminerRubric_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AIExaminerEvaluation"
  ADD CONSTRAINT "AIExaminerEvaluation_answerSheetId_fkey"
  FOREIGN KEY ("answerSheetId") REFERENCES "ExaminationAnswerSheet"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AIExaminerEvaluation"
  ADD CONSTRAINT "AIExaminerEvaluation_rubricId_fkey"
  FOREIGN KEY ("rubricId") REFERENCES "AIExaminerRubric"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AIExaminerEvaluation"
  ADD CONSTRAINT "AIExaminerEvaluation_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AIExaminerEvaluation"
  ADD CONSTRAINT "AIExaminerEvaluation_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AIExaminerQuestionEvaluation"
  ADD CONSTRAINT "AIExaminerQuestionEvaluation_evaluationId_fkey"
  FOREIGN KEY ("evaluationId") REFERENCES "AIExaminerEvaluation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
