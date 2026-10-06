DO $$ BEGIN CREATE TYPE "CampusVisitorType" AS ENUM ('VISITOR','CONTRACTOR','VENDOR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CampusVisitorStatus" AS ENUM ('PRE_REGISTERED','PENDING_APPROVAL','APPROVED','CHECKED_IN','CHECKED_OUT','DENIED','EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PickupAuthorizationStatus" AS ENUM ('ACTIVE','REVOKED','EXPIRED','USED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PickupGateDecision" AS ENUM ('APPROVED','DENIED','REVIEW'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CampusVisitor" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "type" "CampusVisitorType" NOT NULL,
  "fullName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "company" TEXT,
  "hostUserId" TEXT,
  "purpose" TEXT NOT NULL,
  "vehicleNumber" TEXT,
  "idProofType" TEXT,
  "idProofLast4" TEXT,
  "status" "CampusVisitorStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "badgeCode" TEXT,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "preRegisteredById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "checkedInAt" TIMESTAMP(3),
  "checkedOutAt" TIMESTAMP(3),
  "deniedById" TEXT,
  "deniedAt" TIMESTAMP(3),
  "denialReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampusVisitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PickupAuthorization" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "parentId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "guardianName" TEXT NOT NULL,
  "guardianPhone" TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "status" "PickupAuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "qrTokenHash" TEXT,
  "otpHash" TEXT,
  "useLimit" INTEGER NOT NULL DEFAULT 1,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "revokedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PickupAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PickupGateEvent" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "accessPointId" TEXT,
  "decision" "PickupGateDecision" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "processedById" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "PickupGateEvent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PickupAuthorization_parentId_fkey') THEN
  ALTER TABLE "PickupAuthorization" ADD CONSTRAINT "PickupAuthorization_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PickupAuthorization_studentId_fkey') THEN
  ALTER TABLE "PickupAuthorization" ADD CONSTRAINT "PickupAuthorization_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PickupGateEvent_authorizationId_fkey') THEN
  ALTER TABLE "PickupGateEvent" ADD CONSTRAINT "PickupGateEvent_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "PickupAuthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CampusVisitor_organizationId_badgeCode_key" ON "CampusVisitor"("organizationId","badgeCode");
CREATE INDEX IF NOT EXISTS "CampusVisitor_organizationId_branchId_status_validFrom_idx" ON "CampusVisitor"("organizationId","branchId","status","validFrom");
CREATE INDEX IF NOT EXISTS "CampusVisitor_organizationId_hostUserId_status_idx" ON "CampusVisitor"("organizationId","hostUserId","status");
CREATE INDEX IF NOT EXISTS "CampusVisitor_organizationId_phone_createdAt_idx" ON "CampusVisitor"("organizationId","phone","createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PickupAuthorization_qrTokenHash_key" ON "PickupAuthorization"("qrTokenHash");
CREATE INDEX IF NOT EXISTS "PickupAuthorization_organizationId_studentId_status_validUntil_idx" ON "PickupAuthorization"("organizationId","studentId","status","validUntil");
CREATE INDEX IF NOT EXISTS "PickupAuthorization_organizationId_parentId_status_validUntil_idx" ON "PickupAuthorization"("organizationId","parentId","status","validUntil");
CREATE INDEX IF NOT EXISTS "PickupGateEvent_organizationId_branchId_occurredAt_idx" ON "PickupGateEvent"("organizationId","branchId","occurredAt");
CREATE INDEX IF NOT EXISTS "PickupGateEvent_organizationId_authorizationId_occurredAt_idx" ON "PickupGateEvent"("organizationId","authorizationId","occurredAt");
CREATE INDEX IF NOT EXISTS "PickupGateEvent_organizationId_decision_occurredAt_idx" ON "PickupGateEvent"("organizationId","decision","occurredAt");
