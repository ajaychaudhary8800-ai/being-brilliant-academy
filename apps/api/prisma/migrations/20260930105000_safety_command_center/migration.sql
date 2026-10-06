DO $$
BEGIN
  CREATE TYPE "SafetyIncidentStatus" AS ENUM ('OPEN','ACKNOWLEDGED','ACTIVE_RESPONSE','RESOLVED','FALSE_ALARM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EmergencyMode" AS ENUM ('NORMAL','ALERT','SECURE_CAMPUS','EVACUATION','REUNIFICATION','ALL_CLEAR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SafetyIncidentSeverity" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SafetyIncident" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "severity" "SafetyIncidentSeverity" NOT NULL,
  "status" "SafetyIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "emergencyMode" "EmergencyMode" NOT NULL DEFAULT 'NORMAL',
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "schoolEventId" TEXT,
  "deviceEventId" TEXT,
  "reportedById" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "commanderId" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolutionNotes" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SafetyIncidentUpdate" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "emergencyMode" "EmergencyMode",
  "createdById" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SafetyIncidentUpdate_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SafetyIncidentUpdate_incidentId_fkey') THEN
    ALTER TABLE "SafetyIncidentUpdate" ADD CONSTRAINT "SafetyIncidentUpdate_incidentId_fkey"
      FOREIGN KEY ("incidentId") REFERENCES "SafetyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SafetyIncident_organizationId_code_key" ON "SafetyIncident"("organizationId","code");
CREATE UNIQUE INDEX IF NOT EXISTS "SafetyIncident_deviceEventId_key" ON "SafetyIncident"("deviceEventId");
CREATE INDEX IF NOT EXISTS "SafetyIncident_organizationId_branchId_status_severity_idx" ON "SafetyIncident"("organizationId","branchId","status","severity");
CREATE INDEX IF NOT EXISTS "SafetyIncident_organizationId_emergencyMode_status_idx" ON "SafetyIncident"("organizationId","emergencyMode","status");
CREATE INDEX IF NOT EXISTS "SafetyIncidentUpdate_organizationId_incidentId_createdAt_idx" ON "SafetyIncidentUpdate"("organizationId","incidentId","createdAt");
