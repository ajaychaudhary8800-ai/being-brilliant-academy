DO $$ BEGIN CREATE TYPE "CameraStreamKind" AS ENUM ('LIVE','PLAYBACK'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CameraSessionStatus" AS ENUM ('PENDING','READY','FAILED','EXPIRED','REVOKED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CameraAccessAction" AS ENUM ('LIVE_SESSION','PLAYBACK_SESSION','BOOKMARK','EXPORT_REQUEST','EXPORT_APPROVE','EXPORT_DOWNLOAD'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CameraExportStatus" AS ENUM ('PENDING_APPROVAL','PROCESSING','READY','REJECTED','FAILED','EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "CampusCamera"
  ADD COLUMN IF NOT EXISTS "building" TEXT,
  ADD COLUMN IF NOT EXISTS "floor" TEXT,
  ADD COLUMN IF NOT EXISTS "groupName" TEXT,
  ADD COLUMN IF NOT EXISTS "mapX" DECIMAL(8,3),
  ADD COLUMN IF NOT EXISTS "mapY" DECIMAL(8,3),
  ADD COLUMN IF NOT EXISTS "nvrRef" TEXT,
  ADD COLUMN IF NOT EXISTS "channelRef" TEXT,
  ADD COLUMN IF NOT EXISTS "vehicleId" TEXT,
  ADD COLUMN IF NOT EXISTS "watermarkEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "lastTamperAt" TIMESTAMP(3);

ALTER TABLE "ConnectedDeviceCommand"
  ADD COLUMN IF NOT EXISTS "result" JSONB;

CREATE TABLE IF NOT EXISTS "CameraViewSession" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "cameraId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "kind" "CameraStreamKind" NOT NULL,
  "status" "CameraSessionStatus" NOT NULL DEFAULT 'PENDING',
  "commandId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "playbackFrom" TIMESTAMP(3),
  "playbackTo" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "watermarkText" TEXT,
  "lastAccessAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CameraViewSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CameraAccessAudit" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "cameraId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" "CameraAccessAction" NOT NULL,
  "sessionId" TEXT,
  "exportRequestId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "CameraAccessAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CameraBookmark" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "cameraId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CameraBookmark_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CameraExportRequest" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "cameraId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "fromAt" TIMESTAMP(3) NOT NULL,
  "toAt" TIMESTAMP(3) NOT NULL,
  "status" "CameraExportStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "commandId" TEXT,
  "watermarkText" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "externalRef" TEXT,
  "expiresAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CameraExportRequest_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CameraViewSession_cameraId_fkey') THEN
  ALTER TABLE "CameraViewSession" ADD CONSTRAINT "CameraViewSession_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "CampusCamera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CameraAccessAudit_cameraId_fkey') THEN
  ALTER TABLE "CameraAccessAudit" ADD CONSTRAINT "CameraAccessAudit_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "CampusCamera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CameraBookmark_cameraId_fkey') THEN
  ALTER TABLE "CameraBookmark" ADD CONSTRAINT "CameraBookmark_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "CampusCamera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CameraExportRequest_cameraId_fkey') THEN
  ALTER TABLE "CameraExportRequest" ADD CONSTRAINT "CameraExportRequest_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "CampusCamera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CameraViewSession_tokenHash_key" ON "CameraViewSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "CameraViewSession_organizationId_cameraId_createdAt_idx" ON "CameraViewSession"("organizationId","cameraId","createdAt");
CREATE INDEX IF NOT EXISTS "CameraViewSession_organizationId_requestedById_status_idx" ON "CameraViewSession"("organizationId","requestedById","status");
CREATE INDEX IF NOT EXISTS "CameraViewSession_organizationId_status_expiresAt_idx" ON "CameraViewSession"("organizationId","status","expiresAt");
CREATE INDEX IF NOT EXISTS "CameraAccessAudit_organizationId_cameraId_occurredAt_idx" ON "CameraAccessAudit"("organizationId","cameraId","occurredAt");
CREATE INDEX IF NOT EXISTS "CameraAccessAudit_organizationId_userId_occurredAt_idx" ON "CameraAccessAudit"("organizationId","userId","occurredAt");
CREATE INDEX IF NOT EXISTS "CameraBookmark_organizationId_cameraId_occurredAt_idx" ON "CameraBookmark"("organizationId","cameraId","occurredAt");
CREATE INDEX IF NOT EXISTS "CameraBookmark_organizationId_userId_createdAt_idx" ON "CameraBookmark"("organizationId","userId","createdAt");
CREATE INDEX IF NOT EXISTS "CameraExportRequest_organizationId_cameraId_createdAt_idx" ON "CameraExportRequest"("organizationId","cameraId","createdAt");
CREATE INDEX IF NOT EXISTS "CameraExportRequest_organizationId_status_createdAt_idx" ON "CameraExportRequest"("organizationId","status","createdAt");
CREATE INDEX IF NOT EXISTS "CameraExportRequest_organizationId_requestedById_createdAt_idx" ON "CameraExportRequest"("organizationId","requestedById","createdAt");
CREATE INDEX IF NOT EXISTS "CampusCamera_organizationId_vehicleId_idx" ON "CampusCamera"("organizationId","vehicleId");
CREATE INDEX IF NOT EXISTS "CampusCamera_organizationId_branchId_groupName_idx" ON "CampusCamera"("organizationId","branchId","groupName");
