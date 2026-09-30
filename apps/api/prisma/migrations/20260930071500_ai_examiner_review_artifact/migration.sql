-- ERP/LMS 3.1A: anonymized review artifact used by blind/double-blind grading.

CREATE TABLE IF NOT EXISTS "AIExaminerReviewArtifact" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileData" BYTEA NOT NULL,
  "identityMasked" BOOLEAN NOT NULL DEFAULT true,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIExaminerReviewArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AIExaminerReviewArtifact_evaluationId_key"
  ON "AIExaminerReviewArtifact"("evaluationId");
CREATE INDEX IF NOT EXISTS "AIExaminerReviewArtifact_organizationId_createdAt_idx"
  ON "AIExaminerReviewArtifact"("organizationId","createdAt");
CREATE INDEX IF NOT EXISTS "AIExaminerReviewArtifact_uploadedById_idx"
  ON "AIExaminerReviewArtifact"("uploadedById");

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewArtifact"
    ADD CONSTRAINT "AIExaminerReviewArtifact_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewArtifact"
    ADD CONSTRAINT "AIExaminerReviewArtifact_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "AIExaminerEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AIExaminerReviewArtifact"
    ADD CONSTRAINT "AIExaminerReviewArtifact_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
