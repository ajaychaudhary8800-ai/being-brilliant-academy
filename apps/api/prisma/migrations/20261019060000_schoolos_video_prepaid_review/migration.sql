-- SchoolOS V5 Stage 7F2: additive two-person settlement review. No credit activation.
CREATE TABLE "SchoolOSVideoUsageReview" (
 "id" TEXT NOT NULL,
 "organizationId" TEXT NOT NULL,
 "meetingId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING',
 "evidenceSha256" TEXT NOT NULL,
 "eventCount" INTEGER NOT NULL,
 "proposedMinutes" INTEGER NOT NULL,
 "firstEventAt" TIMESTAMP(3) NOT NULL,
 "lastEventAt" TIMESTAMP(3) NOT NULL,
 "proposedBy" TEXT NOT NULL,
 "evidenceReference" TEXT NOT NULL,
 "rationale" TEXT NOT NULL,
 "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reviewedBy" TEXT,
 "reviewedAt" TIMESTAMP(3),
 "reviewComment" TEXT,
 CONSTRAINT "SchoolOSVideoUsageReview_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SchoolOSVideoUsageReview_check" CHECK(
  char_length("evidenceSha256")=64 AND "evidenceSha256"~'^[0-9a-f]{64}$'
  AND "eventCount" BETWEEN 3 AND 10000
  AND "proposedMinutes" BETWEEN 1 AND 100000
  AND "lastEventAt">"firstEventAt"
  AND char_length("evidenceReference") BETWEEN 12 AND 250
  AND char_length("rationale") BETWEEN 20 AND 2000
  AND (
   ("status"='PENDING' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "reviewComment" IS NULL)
   OR ("status" IN ('SETTLED','REJECTED') AND "reviewedBy" IS NOT NULL
      AND "reviewedBy"<>"proposedBy" AND "reviewedAt" IS NOT NULL
      AND char_length("reviewComment") BETWEEN 20 AND 2000)
  )
 )
);
CREATE UNIQUE INDEX "SchoolOSVideoUsageReview_meetingId_key" ON "SchoolOSVideoUsageReview"("meetingId");
CREATE INDEX "SchoolOSVideoUsageReview_organizationId_status_proposedAt_idx"
 ON "SchoolOSVideoUsageReview"("organizationId","status","proposedAt");
ALTER TABLE "SchoolOSVideoUsageReview" ADD CONSTRAINT "SchoolOSVideoUsageReview_organizationId_fkey"
 FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSVideoUsageReview" ADD CONSTRAINT "SchoolOSVideoUsageReview_meetingId_fkey"
 FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION schoolos_video_review_guard_fn()
RETURNS TRIGGER AS $$
DECLARE org TEXT;
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'SCHOOLOS_VIDEO_REVIEW_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 SELECT "organizationId" INTO org FROM "Meeting" WHERE "id"=NEW."meetingId";
 IF org IS NULL OR org<>NEW."organizationId" THEN
  RAISE EXCEPTION 'SCHOOLOS_VIDEO_REVIEW_TENANT_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (
   OLD."status"<>'PENDING' OR NEW."status" NOT IN ('SETTLED','REJECTED')
   OR OLD."organizationId"<>NEW."organizationId"
   OR OLD."meetingId"<>NEW."meetingId"
   OR OLD."evidenceSha256"<>NEW."evidenceSha256"
   OR OLD."eventCount"<>NEW."eventCount"
   OR OLD."proposedMinutes"<>NEW."proposedMinutes"
   OR OLD."firstEventAt"<>NEW."firstEventAt"
   OR OLD."lastEventAt"<>NEW."lastEventAt"
   OR OLD."proposedBy"<>NEW."proposedBy"
   OR OLD."evidenceReference"<>NEW."evidenceReference"
   OR OLD."rationale"<>NEW."rationale"
   OR OLD."proposedAt"<>NEW."proposedAt"
 ) THEN
  RAISE EXCEPTION 'SCHOOLOS_VIDEO_REVIEW_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SchoolOSVideoUsageReview_guard" BEFORE INSERT OR UPDATE OR DELETE
 ON "SchoolOSVideoUsageReview" FOR EACH ROW EXECUTE FUNCTION schoolos_video_review_guard_fn();
-- Late provider webhook data is not allowed to silently change already settled evidence.
CREATE FUNCTION schoolos_livekit_settlement_freeze_fn()
RETURNS TRIGGER AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "SchoolOSVideoUsageReview" r
   WHERE r."meetingId"=NEW."meetingId" AND r."status"='SETTLED') THEN
  RAISE EXCEPTION 'SCHOOLOS_VIDEO_SETTLED_EVIDENCE_FROZEN' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SchoolOSLiveKitEvent_settlement_freeze"
 BEFORE INSERT ON "SchoolOSLiveKitEvent"
 FOR EACH ROW EXECUTE FUNCTION schoolos_livekit_settlement_freeze_fn();
