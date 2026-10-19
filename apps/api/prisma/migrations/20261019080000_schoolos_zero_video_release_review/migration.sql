-- Stage 7F6: zero-billable-minute held-credit release requires
-- independently approved, signed and immutable provider evidence.
ALTER TABLE "SchoolOSVideoUsageReview" DROP CONSTRAINT "SchoolOSVideoUsageReview_check";
ALTER TABLE "SchoolOSVideoUsageReview" ADD CONSTRAINT "SchoolOSVideoUsageReview_check" CHECK(
 char_length("evidenceSha256")=64 AND "evidenceSha256"~'^[0-9a-f]{64}$'
 AND "eventCount" BETWEEN 3 AND 10000
 AND "proposedMinutes" BETWEEN 0 AND 100000
 AND "lastEventAt">"firstEventAt"
 AND char_length("evidenceReference") BETWEEN 12 AND 250
 AND char_length("rationale") BETWEEN 20 AND 2000
 AND (
  ("status"='PENDING' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "reviewComment" IS NULL)
  OR ("status"='SETTLED' AND "proposedMinutes">0
    AND "reviewedBy" IS NOT NULL AND "reviewedBy"<>"proposedBy"
    AND "reviewedAt" IS NOT NULL AND char_length("reviewComment") BETWEEN 20 AND 2000)
  OR ("status"='RELEASED' AND "proposedMinutes"=0
    AND "reviewedBy" IS NOT NULL AND "reviewedBy"<>"proposedBy"
    AND "reviewedAt" IS NOT NULL AND char_length("reviewComment") BETWEEN 20 AND 2000)
  OR ("status"='REJECTED' AND "reviewedBy" IS NOT NULL
    AND "reviewedBy"<>"proposedBy"
    AND "reviewedAt" IS NOT NULL AND char_length("reviewComment") BETWEEN 20 AND 2000)
 )
);
CREATE OR REPLACE FUNCTION schoolos_video_review_guard_fn()
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
   OLD."status"<>'PENDING' OR NEW."status" NOT IN ('SETTLED','REJECTED','RELEASED')
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
-- A signed event cannot be added to a settled or *released* provider proof.
CREATE OR REPLACE FUNCTION schoolos_livekit_settlement_freeze_fn()
RETURNS TRIGGER AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "SchoolOSVideoUsageReview" r
   WHERE r."meetingId"=NEW."meetingId" AND r."status" IN ('SETTLED','RELEASED')) THEN
  RAISE EXCEPTION 'SCHOOLOS_VIDEO_SETTLED_EVIDENCE_FROZEN' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
