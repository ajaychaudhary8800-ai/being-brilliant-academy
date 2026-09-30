DO $$
BEGIN
  CREATE TYPE "CampusAccessPointType" AS ENUM ('MAIN_GATE','INTERNAL_GATE','DOOR','TURNSTILE','VEHICLE_GATE','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CampusAccessDecision" AS ENUM ('GRANTED','DENIED','REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CampusAccessSubjectType" AS ENUM ('STUDENT','EMPLOYEE','VISITOR','UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CampusAccessPoint" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "CampusAccessPointType" NOT NULL,
  "zone" TEXT,
  "deviceId" TEXT,
  "entryDirection" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "policy" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampusAccessPoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CampusAccessEvent" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "accessPointId" TEXT NOT NULL,
  "deviceEventId" TEXT NOT NULL,
  "subjectType" "CampusAccessSubjectType" NOT NULL,
  "subjectId" TEXT,
  "externalSubjectId" TEXT,
  "direction" TEXT,
  "decision" "CampusAccessDecision" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "reviewedById" TEXT,
  "reviewNotes" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampusAccessEvent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampusAccessEvent_accessPointId_fkey') THEN
    ALTER TABLE "CampusAccessEvent" ADD CONSTRAINT "CampusAccessEvent_accessPointId_fkey"
      FOREIGN KEY ("accessPointId") REFERENCES "CampusAccessPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CampusAccessPoint_deviceId_key" ON "CampusAccessPoint"("deviceId");
CREATE UNIQUE INDEX IF NOT EXISTS "CampusAccessPoint_organizationId_branchId_code_key" ON "CampusAccessPoint"("organizationId","branchId","code");
CREATE INDEX IF NOT EXISTS "CampusAccessPoint_organizationId_branchId_isActive_idx" ON "CampusAccessPoint"("organizationId","branchId","isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "CampusAccessEvent_deviceEventId_key" ON "CampusAccessEvent"("deviceEventId");
CREATE INDEX IF NOT EXISTS "CampusAccessEvent_organizationId_accessPointId_occurredAt_idx" ON "CampusAccessEvent"("organizationId","accessPointId","occurredAt");
CREATE INDEX IF NOT EXISTS "CampusAccessEvent_organizationId_subjectType_subjectId_occurredAt_idx" ON "CampusAccessEvent"("organizationId","subjectType","subjectId","occurredAt");
CREATE INDEX IF NOT EXISTS "CampusAccessEvent_organizationId_decision_occurredAt_idx" ON "CampusAccessEvent"("organizationId","decision","occurredAt");
