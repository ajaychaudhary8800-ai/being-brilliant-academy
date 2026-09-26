ALTER TYPE "LiveClassProvider" ADD VALUE IF NOT EXISTS 'NATIVE';

ALTER TABLE "LiveClass"
  ADD COLUMN IF NOT EXISTS "recordingEgressId" TEXT,
  ADD COLUMN IF NOT EXISTS "recordingObjectKey" TEXT,
  ADD COLUMN IF NOT EXISTS "recordingStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "whiteboardData" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "LiveClass_organizationId_meetingId_key"
  ON "LiveClass"("organizationId", "meetingId");

ALTER TABLE "StudyMaterial"
  ADD COLUMN IF NOT EXISTS "storageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceLiveClassId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "StudyMaterial_organizationId_sourceLiveClassId_key"
  ON "StudyMaterial"("organizationId", "sourceLiveClassId");
