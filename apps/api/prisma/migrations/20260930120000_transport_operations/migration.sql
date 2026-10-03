DO $$
BEGIN
  CREATE TYPE "TransportChecklistStatus" AS ENUM ('DRAFT','SUBMITTED','PASSED','BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "TransportChecklistItemStatus" AS ENUM ('PASS','FAIL','NOT_APPLICABLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "TransportReassignmentKind" AS ENUM ('VEHICLE','DRIVER','BOTH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TransportTripChecklist" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "driverId" TEXT,
  "status" "TransportChecklistStatus" NOT NULL DEFAULT 'DRAFT',
  "odometerKm" INTEGER,
  "fuelLevelPercent" DECIMAL(5,2),
  "batteryPercent" DECIMAL(5,2),
  "notes" TEXT,
  "submittedById" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportTripChecklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransportTripChecklistItem" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "checklistId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "status" "TransportChecklistItemStatus" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportTripChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransportTripReassignment" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "kind" "TransportReassignmentKind" NOT NULL,
  "previousVehicleId" TEXT,
  "newVehicleId" TEXT,
  "previousDriverId" TEXT,
  "newDriverId" TEXT,
  "reason" TEXT NOT NULL,
  "changedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportTripReassignment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TransportTripChecklist_tripId_fkey') THEN
    ALTER TABLE "TransportTripChecklist" ADD CONSTRAINT "TransportTripChecklist_tripId_fkey"
      FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TransportTripChecklistItem_checklistId_fkey') THEN
    ALTER TABLE "TransportTripChecklistItem" ADD CONSTRAINT "TransportTripChecklistItem_checklistId_fkey"
      FOREIGN KEY ("checklistId") REFERENCES "TransportTripChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TransportTripReassignment_tripId_fkey') THEN
    ALTER TABLE "TransportTripReassignment" ADD CONSTRAINT "TransportTripReassignment_tripId_fkey"
      FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TransportTripChecklist_tripId_key" ON "TransportTripChecklist"("tripId");
CREATE INDEX IF NOT EXISTS "TransportTripChecklist_organizationId_status_createdAt_idx" ON "TransportTripChecklist"("organizationId","status","createdAt");
CREATE INDEX IF NOT EXISTS "TransportTripChecklist_organizationId_driverId_createdAt_idx" ON "TransportTripChecklist"("organizationId","driverId","createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TransportTripChecklistItem_checklistId_key_key" ON "TransportTripChecklistItem"("checklistId","key");
CREATE INDEX IF NOT EXISTS "TransportTripChecklistItem_organizationId_checklistId_idx" ON "TransportTripChecklistItem"("organizationId","checklistId");
CREATE INDEX IF NOT EXISTS "TransportTripReassignment_organizationId_tripId_createdAt_idx" ON "TransportTripReassignment"("organizationId","tripId","createdAt");
CREATE INDEX IF NOT EXISTS "TransportTripReassignment_organizationId_newVehicleId_createdAt_idx" ON "TransportTripReassignment"("organizationId","newVehicleId","createdAt");
CREATE INDEX IF NOT EXISTS "TransportTripReassignment_organizationId_newDriverId_createdAt_idx" ON "TransportTripReassignment"("organizationId","newDriverId","createdAt");


ALTER TABLE "TransportSafetyPolicy"
  ADD COLUMN IF NOT EXISTS "requirePreTripChecklist" BOOLEAN NOT NULL DEFAULT false;
