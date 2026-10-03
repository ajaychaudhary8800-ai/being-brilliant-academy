ALTER TABLE "AIExaminerEvidenceAttachment"
  ADD COLUMN IF NOT EXISTS "identityMasked" BOOLEAN NOT NULL DEFAULT false;
