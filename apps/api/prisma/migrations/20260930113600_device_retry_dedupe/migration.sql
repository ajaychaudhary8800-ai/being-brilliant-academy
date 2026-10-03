DROP INDEX IF EXISTS "ConnectedDeviceRetryJob_deviceId_operation_eventId_commandId_key";
ALTER TABLE "ConnectedDeviceRetryJob"
  ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

UPDATE "ConnectedDeviceRetryJob"
SET "dedupeKey" = "deviceId" || ':' || "operation" || ':' || COALESCE("eventId",'') || ':' || COALESCE("commandId",'') || ':' || "id"
WHERE "dedupeKey" IS NULL;

ALTER TABLE "ConnectedDeviceRetryJob"
  ALTER COLUMN "dedupeKey" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedDeviceRetryJob_dedupeKey_key"
  ON "ConnectedDeviceRetryJob"("dedupeKey");
