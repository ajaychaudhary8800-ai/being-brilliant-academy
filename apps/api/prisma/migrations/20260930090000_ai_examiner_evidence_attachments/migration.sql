DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AIExaminerEvidenceKind') THEN
    CREATE TYPE "AIExaminerEvidenceKind" AS ENUM ('AUDIO','VIDEO','IMAGE','DOCUMENT','EXTERNAL_REFERENCE','STRUCTURED_OBSERVATION');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AIExaminerEvidenceReviewStatus') THEN
    CREATE TYPE "AIExaminerEvidenceReviewStatus" AS ENUM ('PENDING','VERIFIED','REJECTED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AIExaminerEvidenceAttachment" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "answerSheetId" TEXT NOT NULL,
  "questionKey" TEXT NOT NULL,
  "kind" "AIExaminerEvidenceKind" NOT NULL,
  "status" "AIExaminerEvidenceReviewStatus" NOT NULL DEFAULT 'PENDING',
  "fileName" TEXT,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "fileData" BYTEA,
  "externalUrl" TEXT,
  "contentSha256" TEXT,
  "durationSeconds" INTEGER,
  "transcript" TEXT,
  "observation" JSONB,
  "sourceDevice" TEXT,
  "capturedAt" TIMESTAMP(3),
  "uploadedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewNotes" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIExaminerEvidenceAttachment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIExaminerEvidenceAttachment_organizationId_fkey') THEN
    ALTER TABLE "AIExaminerEvidenceAttachment"
      ADD CONSTRAINT "AIExaminerEvidenceAttachment_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIExaminerEvidenceAttachment_answerSheetId_fkey') THEN
    ALTER TABLE "AIExaminerEvidenceAttachment"
      ADD CONSTRAINT "AIExaminerEvidenceAttachment_answerSheetId_fkey"
      FOREIGN KEY ("answerSheetId") REFERENCES "ExaminationAnswerSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIExaminerEvidenceAttachment_uploadedById_fkey') THEN
    ALTER TABLE "AIExaminerEvidenceAttachment"
      ADD CONSTRAINT "AIExaminerEvidenceAttachment_uploadedById_fkey"
      FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIExaminerEvidenceAttachment_reviewedById_fkey') THEN
    ALTER TABLE "AIExaminerEvidenceAttachment"
      ADD CONSTRAINT "AIExaminerEvidenceAttachment_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AIExaminerEvidenceAttachment_organizationId_answerSheetId_questionKey_idx"
  ON "AIExaminerEvidenceAttachment"("organizationId","answerSheetId","questionKey");
CREATE INDEX IF NOT EXISTS "AIExaminerEvidenceAttachment_organizationId_status_createdAt_idx"
  ON "AIExaminerEvidenceAttachment"("organizationId","status","createdAt");
CREATE INDEX IF NOT EXISTS "AIExaminerEvidenceAttachment_uploadedById_idx"
  ON "AIExaminerEvidenceAttachment"("uploadedById");
CREATE INDEX IF NOT EXISTS "AIExaminerEvidenceAttachment_reviewedById_idx"
  ON "AIExaminerEvidenceAttachment"("reviewedById");
