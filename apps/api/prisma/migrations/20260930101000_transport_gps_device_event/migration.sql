ALTER TABLE "TransportGpsPoint"
  ADD COLUMN IF NOT EXISTS "deviceEventId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "TransportGpsPoint_deviceEventId_key"
  ON "TransportGpsPoint"("deviceEventId");
