DO $$
BEGIN
  CREATE TYPE "CameraIncidentSeverity" AS ENUM ('INFO','LOW','MEDIUM','HIGH','CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CameraIncidentStatus" AS ENUM ('OPEN','ACKNOWLEDGED','INVESTIGATING','RESOLVED','DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CampusCamera" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "zone" TEXT,
  "location" TEXT,
  "streamSecretRef" TEXT,
  "recordingSecretRef" TEXT,
  "retentionDays" INTEGER NOT NULL DEFAULT 30,
  "privacyMasking" BOOLEAN NOT NULL DEFAULT true,
  "audioEnabled" BOOLEAN NOT NULL DEFAULT false,
  "aiReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampusCamera_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CameraIncident" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "cameraId" TEXT NOT NULL,
  "deviceEventId" TEXT,
  "eventType" TEXT NOT NULL,
  "severity" "CameraIncidentSeverity" NOT NULL DEFAULT 'INFO',
  "status" "CameraIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "confidence" DECIMAL(5,4),
  "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
  "clipExternalRef" TEXT,
  "snapshotExternalRef" TEXT,
  "metadata" JSONB,
  "acknowledgedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolutionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CameraIncident_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CameraIncident_cameraId_fkey') THEN
    ALTER TABLE "CameraIncident" ADD CONSTRAINT "CameraIncident_cameraId_fkey"
      FOREIGN KEY ("cameraId") REFERENCES "CampusCamera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CampusCamera_deviceId_key" ON "CampusCamera"("deviceId");
CREATE UNIQUE INDEX IF NOT EXISTS "CampusCamera_organizationId_branchId_code_key" ON "CampusCamera"("organizationId","branchId","code");
CREATE INDEX IF NOT EXISTS "CampusCamera_organizationId_branchId_isActive_idx" ON "CampusCamera"("organizationId","branchId","isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "CameraIncident_deviceEventId_key" ON "CameraIncident"("deviceEventId");
CREATE INDEX IF NOT EXISTS "CameraIncident_organizationId_cameraId_occurredAt_idx" ON "CameraIncident"("organizationId","cameraId","occurredAt");
CREATE INDEX IF NOT EXISTS "CameraIncident_organizationId_status_severity_occurredAt_idx" ON "CameraIncident"("organizationId","status","severity","occurredAt");
