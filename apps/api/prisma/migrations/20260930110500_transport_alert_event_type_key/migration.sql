DROP INDEX IF EXISTS "TransportAlert_sourceEventId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "TransportAlert_sourceEventId_type_key"
  ON "TransportAlert"("sourceEventId","type");
