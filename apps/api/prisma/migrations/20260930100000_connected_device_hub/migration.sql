DO $$
BEGIN
  CREATE TYPE "ConnectedDeviceKind" AS ENUM ('BIOMETRIC','RFID','GPS','CAMERA','ACCESS_CONTROL','ENVIRONMENT_SENSOR','EDGE_GATEWAY','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ConnectedDeviceProtocol" AS ENUM ('WEBHOOK','REST_PULL','MQTT','TCP_PUSH','ONVIF','RTSP','SDK','MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ConnectedDeviceStatus" AS ENUM ('PROVISIONING','ACTIVE','OFFLINE','DEGRADED','DISABLED','RETIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ConnectedDeviceEventStatus" AS ENUM ('RECEIVED','NORMALIZED','PROCESSED','REJECTED','DUPLICATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ConnectedDeviceBindingType" AS ENUM ('STUDENT','EMPLOYEE','VEHICLE','GATE','CAMERA','ROUTE','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ConnectedDeviceCommandStatus" AS ENUM ('QUEUED','SENT','ACKNOWLEDGED','FAILED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ConnectedDevice" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "ConnectedDeviceKind" NOT NULL,
  "protocol" "ConnectedDeviceProtocol" NOT NULL,
  "providerKey" TEXT NOT NULL,
  "externalDeviceId" TEXT,
  "status" "ConnectedDeviceStatus" NOT NULL DEFAULT 'PROVISIONING',
  "ingestTokenHash" TEXT,
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "config" JSONB,
  "metadata" JSONB,
  "firmwareVersion" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "lastErrorAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectedDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConnectedDeviceEvent" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "externalEventId" TEXT,
  "eventType" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload" JSONB NOT NULL,
  "normalized" JSONB,
  "status" "ConnectedDeviceEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "sourceHash" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "ConnectedDeviceEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConnectedDeviceBinding" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "bindingType" "ConnectedDeviceBindingType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "externalSubjectId" TEXT,
  "label" TEXT,
  "metadata" JSONB,
  "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activeUntil" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectedDeviceBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConnectedDeviceCommand" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "commandType" TEXT NOT NULL,
  "payload" JSONB,
  "status" "ConnectedDeviceCommandStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" TEXT NOT NULL,
  "requestedById" TEXT,
  "sentAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectedDeviceCommand_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConnectedDeviceEvent_deviceId_fkey') THEN
    ALTER TABLE "ConnectedDeviceEvent" ADD CONSTRAINT "ConnectedDeviceEvent_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "ConnectedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConnectedDeviceBinding_deviceId_fkey') THEN
    ALTER TABLE "ConnectedDeviceBinding" ADD CONSTRAINT "ConnectedDeviceBinding_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "ConnectedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConnectedDeviceCommand_deviceId_fkey') THEN
    ALTER TABLE "ConnectedDeviceCommand" ADD CONSTRAINT "ConnectedDeviceCommand_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "ConnectedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedDevice_organizationId_code_key" ON "ConnectedDevice"("organizationId","code");
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedDevice_organizationId_providerKey_externalDeviceId_key" ON "ConnectedDevice"("organizationId","providerKey","externalDeviceId");
CREATE INDEX IF NOT EXISTS "ConnectedDevice_organizationId_branchId_status_idx" ON "ConnectedDevice"("organizationId","branchId","status");
CREATE INDEX IF NOT EXISTS "ConnectedDevice_organizationId_kind_status_idx" ON "ConnectedDevice"("organizationId","kind","status");

CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedDeviceEvent_deviceId_externalEventId_key" ON "ConnectedDeviceEvent"("deviceId","externalEventId");
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedDeviceEvent_deviceId_sourceHash_key" ON "ConnectedDeviceEvent"("deviceId","sourceHash");
CREATE INDEX IF NOT EXISTS "ConnectedDeviceEvent_organizationId_eventType_occurredAt_idx" ON "ConnectedDeviceEvent"("organizationId","eventType","occurredAt");
CREATE INDEX IF NOT EXISTS "ConnectedDeviceEvent_organizationId_status_receivedAt_idx" ON "ConnectedDeviceEvent"("organizationId","status","receivedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedDeviceBinding_deviceId_bindingType_entityId_key" ON "ConnectedDeviceBinding"("deviceId","bindingType","entityId");
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedDeviceBinding_deviceId_externalSubjectId_key" ON "ConnectedDeviceBinding"("deviceId","externalSubjectId");
CREATE INDEX IF NOT EXISTS "ConnectedDeviceBinding_organizationId_bindingType_entityId_isActive_idx" ON "ConnectedDeviceBinding"("organizationId","bindingType","entityId","isActive");
CREATE INDEX IF NOT EXISTS "ConnectedDeviceBinding_organizationId_deviceId_isActive_idx" ON "ConnectedDeviceBinding"("organizationId","deviceId","isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedDeviceCommand_deviceId_idempotencyKey_key" ON "ConnectedDeviceCommand"("deviceId","idempotencyKey");
CREATE INDEX IF NOT EXISTS "ConnectedDeviceCommand_organizationId_status_createdAt_idx" ON "ConnectedDeviceCommand"("organizationId","status","createdAt");
