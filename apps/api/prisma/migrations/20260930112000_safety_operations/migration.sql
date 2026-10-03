DO $$ BEGIN CREATE TYPE "SafetyTaskStatus" AS ENUM ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SafetyDrillStatus" AS ENUM ('PLANNED','ACTIVE','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SafetyAccountabilityStatus" AS ENUM ('UNKNOWN','SAFE','MISSING','EVACUATED','REUNIFIED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SafetySubjectType" AS ENUM ('STUDENT','EMPLOYEE','VISITOR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SafetyBroadcastAudience" AS ENUM ('ALL','PARENTS','STAFF','STUDENTS'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SafetyAcknowledgementResponse" AS ENUM ('ACKNOWLEDGED','SAFE','NEED_HELP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CampusZone" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "building" TEXT,
  "floor" TEXT,
  "capacity" INTEGER,
  "geometry" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampusZone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SafetyBroadcast" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "incidentId" TEXT,
  "audience" "SafetyBroadcastAudience" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "channels" TEXT[] NOT NULL DEFAULT ARRAY['IN_APP']::TEXT[],
  "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SafetyBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SafetyBroadcastAcknowledgement" (
  "organizationId" TEXT NOT NULL,
  "broadcastId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "response" "SafetyAcknowledgementResponse" NOT NULL DEFAULT 'ACKNOWLEDGED',
  "message" TEXT,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SafetyBroadcastAcknowledgement_pkey" PRIMARY KEY ("broadcastId","userId")
);

CREATE TABLE IF NOT EXISTS "SafetyIncidentAcknowledgement" (
  "organizationId" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "response" "SafetyAcknowledgementResponse" NOT NULL DEFAULT 'ACKNOWLEDGED',
  "message" TEXT,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SafetyIncidentAcknowledgement_pkey" PRIMARY KEY ("incidentId","userId")
);

CREATE TABLE IF NOT EXISTS "SafetyTask" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "SafetyTaskStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "SchoolEventSeverity" NOT NULL DEFAULT 'MEDIUM',
  "assignedToId" TEXT,
  "dueAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "completedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafetyTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SafetyDrill" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "scenario" TEXT,
  "status" "SafetyDrillStatus" NOT NULL DEFAULT 'PLANNED',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafetyDrill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SafetyAccountability" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "subjectType" "SafetySubjectType" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "status" "SafetyAccountabilityStatus" NOT NULL DEFAULT 'UNKNOWN',
  "zoneId" TEXT,
  "lastSeenAt" TIMESTAMP(3),
  "recordedById" TEXT,
  "notes" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafetyAccountability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SafetyReunificationRecord" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "authorizationId" TEXT,
  "guardianName" TEXT NOT NULL,
  "guardianPhone" TEXT,
  "relationship" TEXT,
  "verifiedById" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "SafetyReunificationRecord_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SafetyBroadcast_incidentId_fkey') THEN
  ALTER TABLE "SafetyBroadcast" ADD CONSTRAINT "SafetyBroadcast_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SafetyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SafetyBroadcastAcknowledgement_broadcastId_fkey') THEN
  ALTER TABLE "SafetyBroadcastAcknowledgement" ADD CONSTRAINT "SafetyBroadcastAcknowledgement_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "SafetyBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SafetyIncidentAcknowledgement_incidentId_fkey') THEN
  ALTER TABLE "SafetyIncidentAcknowledgement" ADD CONSTRAINT "SafetyIncidentAcknowledgement_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SafetyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SafetyTask_incidentId_fkey') THEN
  ALTER TABLE "SafetyTask" ADD CONSTRAINT "SafetyTask_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SafetyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SafetyAccountability_incidentId_fkey') THEN
  ALTER TABLE "SafetyAccountability" ADD CONSTRAINT "SafetyAccountability_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SafetyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SafetyReunificationRecord_incidentId_fkey') THEN
  ALTER TABLE "SafetyReunificationRecord" ADD CONSTRAINT "SafetyReunificationRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SafetyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CampusZone_organizationId_branchId_code_key" ON "CampusZone"("organizationId","branchId","code");
CREATE INDEX IF NOT EXISTS "CampusZone_organizationId_branchId_isActive_idx" ON "CampusZone"("organizationId","branchId","isActive");
CREATE INDEX IF NOT EXISTS "SafetyBroadcast_organizationId_branchId_sentAt_idx" ON "SafetyBroadcast"("organizationId","branchId","sentAt");
CREATE INDEX IF NOT EXISTS "SafetyBroadcast_organizationId_incidentId_sentAt_idx" ON "SafetyBroadcast"("organizationId","incidentId","sentAt");
CREATE INDEX IF NOT EXISTS "SafetyBroadcastAcknowledgement_organizationId_userId_acknowledgedAt_idx" ON "SafetyBroadcastAcknowledgement"("organizationId","userId","acknowledgedAt");
CREATE INDEX IF NOT EXISTS "SafetyIncidentAcknowledgement_organizationId_userId_acknowledgedAt_idx" ON "SafetyIncidentAcknowledgement"("organizationId","userId","acknowledgedAt");
CREATE INDEX IF NOT EXISTS "SafetyTask_organizationId_incidentId_status_idx" ON "SafetyTask"("organizationId","incidentId","status");
CREATE INDEX IF NOT EXISTS "SafetyTask_organizationId_assignedToId_status_idx" ON "SafetyTask"("organizationId","assignedToId","status");
CREATE INDEX IF NOT EXISTS "SafetyDrill_organizationId_branchId_status_scheduledAt_idx" ON "SafetyDrill"("organizationId","branchId","status","scheduledAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SafetyAccountability_incidentId_subjectType_subjectId_key" ON "SafetyAccountability"("incidentId","subjectType","subjectId");
CREATE INDEX IF NOT EXISTS "SafetyAccountability_organizationId_incidentId_status_idx" ON "SafetyAccountability"("organizationId","incidentId","status");
CREATE INDEX IF NOT EXISTS "SafetyAccountability_organizationId_zoneId_status_idx" ON "SafetyAccountability"("organizationId","zoneId","status");
CREATE UNIQUE INDEX IF NOT EXISTS "SafetyReunificationRecord_incidentId_studentId_key" ON "SafetyReunificationRecord"("incidentId","studentId");
CREATE INDEX IF NOT EXISTS "SafetyReunificationRecord_organizationId_incidentId_releasedAt_idx" ON "SafetyReunificationRecord"("organizationId","incidentId","releasedAt");
CREATE INDEX IF NOT EXISTS "SafetyReunificationRecord_organizationId_studentId_releasedAt_idx" ON "SafetyReunificationRecord"("organizationId","studentId","releasedAt");
