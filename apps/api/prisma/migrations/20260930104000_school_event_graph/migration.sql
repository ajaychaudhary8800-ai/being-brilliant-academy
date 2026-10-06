DO $$
BEGIN
  CREATE TYPE "SchoolEventCategory" AS ENUM ('ATTENDANCE','ACCESS','TRANSPORT','CAMERA','SAFETY','VISITOR','PICKUP','DEVICE','COMMUNICATION','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SchoolEventSeverity" AS ENUM ('INFO','LOW','MEDIUM','HIGH','CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SchoolEventStatus" AS ENUM ('RECORDED','REVIEW_REQUIRED','ACKNOWLEDGED','RESOLVED','DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SchoolEvent" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT,
  "category" "SchoolEventCategory" NOT NULL,
  "type" TEXT NOT NULL,
  "severity" "SchoolEventSeverity" NOT NULL DEFAULT 'INFO',
  "status" "SchoolEventStatus" NOT NULL DEFAULT 'RECORDED',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "correlationKey" TEXT,
  "studentId" TEXT,
  "employeeId" TEXT,
  "vehicleId" TEXT,
  "deviceId" TEXT,
  "accessPointId" TEXT,
  "cameraId" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "metadata" JSONB,
  "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "acknowledgedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolutionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SchoolEvent_organizationId_sourceType_sourceId_key"
  ON "SchoolEvent"("organizationId","sourceType","sourceId");
CREATE INDEX IF NOT EXISTS "SchoolEvent_organizationId_branchId_occurredAt_idx"
  ON "SchoolEvent"("organizationId","branchId","occurredAt");
CREATE INDEX IF NOT EXISTS "SchoolEvent_organizationId_category_status_occurredAt_idx"
  ON "SchoolEvent"("organizationId","category","status","occurredAt");
CREATE INDEX IF NOT EXISTS "SchoolEvent_organizationId_studentId_occurredAt_idx"
  ON "SchoolEvent"("organizationId","studentId","occurredAt");
CREATE INDEX IF NOT EXISTS "SchoolEvent_organizationId_employeeId_occurredAt_idx"
  ON "SchoolEvent"("organizationId","employeeId","occurredAt");
CREATE INDEX IF NOT EXISTS "SchoolEvent_organizationId_vehicleId_occurredAt_idx"
  ON "SchoolEvent"("organizationId","vehicleId","occurredAt");
CREATE INDEX IF NOT EXISTS "SchoolEvent_organizationId_correlationKey_occurredAt_idx"
  ON "SchoolEvent"("organizationId","correlationKey","occurredAt");
