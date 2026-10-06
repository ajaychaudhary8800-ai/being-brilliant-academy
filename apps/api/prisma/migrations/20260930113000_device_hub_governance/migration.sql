DO $$ BEGIN CREATE TYPE "DeviceConnectorStatus" AS ENUM ('CONFIGURING','ACTIVE','DEGRADED','DISABLED','ERROR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DeviceRetryStatus" AS ENUM ('QUEUED','PROCESSING','COMPLETED','DEAD_LETTER','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EdgeAgentStatus" AS ENUM ('PROVISIONING','ONLINE','OFFLINE','DEGRADED','DISABLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ConnectedDevice"
  ADD COLUMN IF NOT EXISTS "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "signingPublicKey" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSignatureAt" TIMESTAMP(3);

ALTER TABLE "ConnectedDeviceEvent"
  ADD COLUMN IF NOT EXISTS "eventDelayMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "signatureVerified" BOOLEAN;

CREATE TABLE IF NOT EXISTS "DeviceAdapterRegistry" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "vendor" TEXT,
  "version" TEXT NOT NULL,
  "protocols" "ConnectedDeviceProtocol"[] NOT NULL,
  "deviceKinds" "ConnectedDeviceKind"[] NOT NULL,
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "configSchema" JSONB,
  "supportsEdgeAgent" BOOLEAN NOT NULL DEFAULT false,
  "supportsDiscovery" BOOLEAN NOT NULL DEFAULT false,
  "requiredEntitlement" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceAdapterRegistry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DeviceConnectorInstance" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT,
  "adapterId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "DeviceConnectorStatus" NOT NULL DEFAULT 'CONFIGURING',
  "secretRef" TEXT,
  "config" JSONB,
  "lastSyncAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "latencyMs" INTEGER,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceConnectorInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConnectedDeviceRetryJob" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "eventId" TEXT,
  "commandId" TEXT,
  "operation" TEXT NOT NULL,
  "status" "DeviceRetryStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectedDeviceRetryJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConnectedCampusEdgeAgent" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "EdgeAgentStatus" NOT NULL DEFAULT 'PROVISIONING',
  "tokenHash" TEXT,
  "publicKey" TEXT,
  "version" TEXT,
  "os" TEXT,
  "hostname" TEXT,
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "lastIpHash" TEXT,
  "lastErrorCode" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectedCampusEdgeAgent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='DeviceConnectorInstance_adapterId_fkey') THEN
  ALTER TABLE "DeviceConnectorInstance" ADD CONSTRAINT "DeviceConnectorInstance_adapterId_fkey" FOREIGN KEY ("adapterId") REFERENCES "DeviceAdapterRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ConnectedDeviceRetryJob_deviceId_fkey') THEN
  ALTER TABLE "ConnectedDeviceRetryJob" ADD CONSTRAINT "ConnectedDeviceRetryJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ConnectedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "DeviceAdapterRegistry_key_key" ON "DeviceAdapterRegistry"("key");
CREATE INDEX IF NOT EXISTS "DeviceAdapterRegistry_isActive_name_idx" ON "DeviceAdapterRegistry"("isActive","name");
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceConnectorInstance_organizationId_name_key" ON "DeviceConnectorInstance"("organizationId","name");
CREATE INDEX IF NOT EXISTS "DeviceConnectorInstance_organizationId_branchId_status_idx" ON "DeviceConnectorInstance"("organizationId","branchId","status");
CREATE INDEX IF NOT EXISTS "DeviceConnectorInstance_organizationId_adapterId_status_idx" ON "DeviceConnectorInstance"("organizationId","adapterId","status");
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedDeviceRetryJob_deviceId_operation_eventId_commandId_key" ON "ConnectedDeviceRetryJob"("deviceId","operation","eventId","commandId");
CREATE INDEX IF NOT EXISTS "ConnectedDeviceRetryJob_organizationId_status_nextAttemptAt_idx" ON "ConnectedDeviceRetryJob"("organizationId","status","nextAttemptAt");
CREATE INDEX IF NOT EXISTS "ConnectedDeviceRetryJob_organizationId_deviceId_status_idx" ON "ConnectedDeviceRetryJob"("organizationId","deviceId","status");
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedCampusEdgeAgent_organizationId_branchId_code_key" ON "ConnectedCampusEdgeAgent"("organizationId","branchId","code");
CREATE INDEX IF NOT EXISTS "ConnectedCampusEdgeAgent_organizationId_branchId_status_idx" ON "ConnectedCampusEdgeAgent"("organizationId","branchId","status");
