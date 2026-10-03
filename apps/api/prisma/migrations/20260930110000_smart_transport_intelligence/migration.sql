DO $$
BEGIN CREATE TYPE "TransportAlertType" AS ENUM ('OVERSPEED','HARSH_BRAKING','HARSH_ACCELERATION','ROUTE_DEVIATION','UNAUTHORIZED_HALT','DELAYED_START','GPS_OFFLINE','GEOFENCE','WRONG_BUS','WRONG_STOP','MISSED_BUS','STUDENT_STILL_ONBOARD','DOCUMENT_EXPIRY','SERVICE_DUE','DRIVER_BEHAVIOR','VEHICLE_DIAGNOSTIC','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TransportAlertStatus" AS ENUM ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TransportRidershipEventType" AS ENUM ('BOARD','DEBOARD'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TransportRidershipMethod" AS ENUM ('RFID','NFC','QR','BIOMETRIC','MANUAL','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TransportRideCancellationScope" AS ENUM ('PICKUP','DROP','BOTH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TransportGeofenceType" AS ENUM ('CIRCLE','POLYGON','ROUTE_CORRIDOR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "TransportVehicle"
  ADD COLUMN IF NOT EXISTS "currentHeading" DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "ignitionOn" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "odometerKm" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "batteryPercent" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "estimatedRangeKm" DECIMAL(8,2);

ALTER TABLE "TransportTrip"
  ADD COLUMN IF NOT EXISTS "routeProgressPercent" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "etaMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastEtaAt" TIMESTAMP(3);

ALTER TABLE "TransportGpsPoint"
  ADD COLUMN IF NOT EXISTS "heading" DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "ignitionOn" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "odometerKm" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "accelerationMps2" DECIMAL(8,3);

CREATE TABLE IF NOT EXISTS "TransportSafetyPolicy" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "overspeedKph" DECIMAL(7,2) NOT NULL DEFAULT 60,
  "harshAccelerationMps2" DECIMAL(8,3) NOT NULL DEFAULT 3.0,
  "harshBrakingMps2" DECIMAL(8,3) NOT NULL DEFAULT -3.5,
  "unauthorizedHaltMinutes" INTEGER NOT NULL DEFAULT 10,
  "gpsOfflineMinutes" INTEGER NOT NULL DEFAULT 5,
  "delayedStartMinutes" INTEGER NOT NULL DEFAULT 10,
  "routeDeviationMeters" INTEGER NOT NULL DEFAULT 500,
  "stopGeofenceMeters" INTEGER NOT NULL DEFAULT 250,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportSafetyPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransportGeofence" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "routeId" TEXT,
  "stopId" TEXT,
  "name" TEXT NOT NULL,
  "type" "TransportGeofenceType" NOT NULL,
  "geometry" JSONB NOT NULL,
  "radiusMeters" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportGeofence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransportAlert" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "tripId" TEXT,
  "vehicleId" TEXT NOT NULL,
  "studentId" TEXT,
  "sourceEventId" TEXT,
  "type" "TransportAlertType" NOT NULL,
  "status" "TransportAlertStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "SchoolEventSeverity" NOT NULL DEFAULT 'MEDIUM',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolutionNotes" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransportRidershipEvent" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "tripId" TEXT,
  "studentId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "stopId" TEXT,
  "type" "TransportRidershipEventType" NOT NULL,
  "method" "TransportRidershipMethod" NOT NULL,
  "deviceEventId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportRidershipEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransportRideCancellation" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "scope" "TransportRideCancellationScope" NOT NULL,
  "reason" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportRideCancellation_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TransportGeofence_routeId_fkey') THEN
  ALTER TABLE "TransportGeofence" ADD CONSTRAINT "TransportGeofence_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TransportAlert_tripId_fkey') THEN
  ALTER TABLE "TransportAlert" ADD CONSTRAINT "TransportAlert_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TransportAlert_vehicleId_fkey') THEN
  ALTER TABLE "TransportAlert" ADD CONSTRAINT "TransportAlert_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "TransportVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TransportRidershipEvent_assignmentId_fkey') THEN
  ALTER TABLE "TransportRidershipEvent" ADD CONSTRAINT "TransportRidershipEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentTransportAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TransportRidershipEvent_tripId_fkey') THEN
  ALTER TABLE "TransportRidershipEvent" ADD CONSTRAINT "TransportRidershipEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TransportRideCancellation_assignmentId_fkey') THEN
  ALTER TABLE "TransportRideCancellation" ADD CONSTRAINT "TransportRideCancellation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentTransportAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TransportSafetyPolicy_branchId_key" ON "TransportSafetyPolicy"("branchId");
CREATE INDEX IF NOT EXISTS "TransportSafetyPolicy_organizationId_branchId_idx" ON "TransportSafetyPolicy"("organizationId","branchId");
CREATE UNIQUE INDEX IF NOT EXISTS "TransportGeofence_organizationId_branchId_name_key" ON "TransportGeofence"("organizationId","branchId","name");
CREATE INDEX IF NOT EXISTS "TransportGeofence_organizationId_branchId_isActive_idx" ON "TransportGeofence"("organizationId","branchId","isActive");
CREATE INDEX IF NOT EXISTS "TransportGeofence_organizationId_routeId_isActive_idx" ON "TransportGeofence"("organizationId","routeId","isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "TransportAlert_sourceEventId_key" ON "TransportAlert"("sourceEventId");
CREATE INDEX IF NOT EXISTS "TransportAlert_organizationId_branchId_status_occurredAt_idx" ON "TransportAlert"("organizationId","branchId","status","occurredAt");
CREATE INDEX IF NOT EXISTS "TransportAlert_organizationId_vehicleId_occurredAt_idx" ON "TransportAlert"("organizationId","vehicleId","occurredAt");
CREATE INDEX IF NOT EXISTS "TransportAlert_organizationId_studentId_occurredAt_idx" ON "TransportAlert"("organizationId","studentId","occurredAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TransportRidershipEvent_deviceEventId_key" ON "TransportRidershipEvent"("deviceEventId");
CREATE INDEX IF NOT EXISTS "TransportRidershipEvent_organizationId_studentId_occurredAt_idx" ON "TransportRidershipEvent"("organizationId","studentId","occurredAt");
CREATE INDEX IF NOT EXISTS "TransportRidershipEvent_organizationId_tripId_occurredAt_idx" ON "TransportRidershipEvent"("organizationId","tripId","occurredAt");
CREATE INDEX IF NOT EXISTS "TransportRidershipEvent_organizationId_vehicleId_occurredAt_idx" ON "TransportRidershipEvent"("organizationId","vehicleId","occurredAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TransportRideCancellation_assignmentId_date_scope_key" ON "TransportRideCancellation"("assignmentId","date","scope");
CREATE INDEX IF NOT EXISTS "TransportRideCancellation_organizationId_studentId_date_idx" ON "TransportRideCancellation"("organizationId","studentId","date");
