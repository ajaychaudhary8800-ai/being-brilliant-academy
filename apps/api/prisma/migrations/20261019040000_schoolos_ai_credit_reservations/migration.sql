-- Stage 7E1: prepaid AI credit admission reservations (additive; no backfill).
CREATE TABLE "SchoolOSUsageReservation" (
 "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "balanceId" TEXT NOT NULL,
 "metric" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "units" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'RESERVED', "actorId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, "committedAt" TIMESTAMP(3),
 "releasedAt" TIMESTAMP(3), "releaseReason" TEXT,
 CONSTRAINT "SchoolOSUsageReservation_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SchoolOSUsageReservation_state_check" CHECK (
  "metric"='ai_credits' AND "units"=1 AND char_length("requestKey") BETWEEN 8 AND 120
  AND (
    ("status"='RESERVED' AND "committedAt" IS NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
    OR ("status"='COMMITTED' AND "committedAt" IS NOT NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
    OR ("status"='RELEASED' AND "committedAt" IS NULL AND "releasedAt" IS NOT NULL
       AND char_length("releaseReason") BETWEEN 12 AND 500)
  )
 )
);
CREATE UNIQUE INDEX "SchoolOSUsageReservation_organizationId_metric_requestKey_key"
 ON "SchoolOSUsageReservation"("organizationId","metric","requestKey");
CREATE INDEX "SchoolOSUsageReservation_organizationId_status_createdAt_idx"
 ON "SchoolOSUsageReservation"("organizationId","status","createdAt");
CREATE INDEX "SchoolOSUsageReservation_balanceId_status_idx"
 ON "SchoolOSUsageReservation"("balanceId","status");
ALTER TABLE "SchoolOSUsageReservation" ADD CONSTRAINT "SchoolOSUsageReservation_organizationId_fkey"
 FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSUsageReservation" ADD CONSTRAINT "SchoolOSUsageReservation_balanceId_fkey"
 FOREIGN KEY ("balanceId") REFERENCES "SchoolOSUsageBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION schoolos_usage_reservation_tenant_guard_fn()
RETURNS TRIGGER AS $$
DECLARE balance_tenant TEXT;
DECLARE balance_metric TEXT;
BEGIN
 SELECT "organizationId","metric" INTO balance_tenant,balance_metric
 FROM "SchoolOSUsageBalance" WHERE "id"=NEW."balanceId";
 IF balance_tenant IS NULL OR balance_tenant<>NEW."organizationId" OR balance_metric<>NEW."metric" THEN
   RAISE EXCEPTION 'SCHOOLOS_AI_RESERVATION_TENANT_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (
   OLD."organizationId"<>NEW."organizationId" OR OLD."balanceId"<>NEW."balanceId" OR
   OLD."metric"<>NEW."metric" OR OLD."requestKey"<>NEW."requestKey" OR
   OLD."units"<>NEW."units" OR OLD."actorId" IS DISTINCT FROM NEW."actorId" OR
   OLD."createdAt"<>NEW."createdAt" OR OLD."status"<>'RESERVED' OR
   NEW."status" NOT IN ('COMMITTED','RELEASED')
 ) THEN
   RAISE EXCEPTION 'SCHOOLOS_AI_RESERVATION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SchoolOSUsageReservation_tenant_guard"
 BEFORE INSERT OR UPDATE ON "SchoolOSUsageReservation"
 FOR EACH ROW EXECUTE FUNCTION schoolos_usage_reservation_tenant_guard_fn();
