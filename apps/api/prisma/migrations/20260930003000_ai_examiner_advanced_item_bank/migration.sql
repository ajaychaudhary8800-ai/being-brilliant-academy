-- ERP/LMS 3.1: extend the existing LMS question bank for Ranpal AI Examiner Advanced.
-- Add enum values without removing any Version 3.0 values.
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'TRUE_FALSE';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'FILL_BLANK';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'ONE_WORD';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'SHORT_ANSWER';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'LONG_ANSWER';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'CASE_STUDY';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'DERIVATION';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'PROOF';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'CALCULATION';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'DIAGRAM';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'GRAPH';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'MAP';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'GEOMETRY_CONSTRUCTION';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'CHEMISTRY_EQUATION';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'ACCOUNTING_STATEMENT';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'PROGRAMMING';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'ESSAY';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'LANGUAGE';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'ORAL_AUDIO_VIDEO';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'PRACTICAL_PROJECT_VIVA';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'EARLY_YEARS_VISUAL';

ALTER TABLE "QuestionBankItem"
  ADD COLUMN IF NOT EXISTS "classLevel" "ClassLevel",
  ADD COLUMN IF NOT EXISTS "academicBoard" "AcademicBoard",
  ADD COLUMN IF NOT EXISTS "customBoardName" TEXT,
  ADD COLUMN IF NOT EXISTS "syllabusCode" TEXT,
  ADD COLUMN IF NOT EXISTS "learningOutcomes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "expectedTimeSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "variantGroupCode" TEXT,
  ADD COLUMN IF NOT EXISTS "similarityHash" TEXT,
  ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "evaluationConfig" JSONB;

CREATE INDEX IF NOT EXISTS "QuestionBankItem_organizationId_classLevel_academicBoard_idx"
  ON "QuestionBankItem"("organizationId", "classLevel", "academicBoard");
CREATE INDEX IF NOT EXISTS "QuestionBankItem_organizationId_variantGroupCode_idx"
  ON "QuestionBankItem"("organizationId", "variantGroupCode");
CREATE INDEX IF NOT EXISTS "QuestionBankItem_organizationId_similarityHash_idx"
  ON "QuestionBankItem"("organizationId", "similarityHash");
