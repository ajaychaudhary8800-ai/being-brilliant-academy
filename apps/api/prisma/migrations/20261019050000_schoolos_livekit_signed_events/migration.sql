-- SchoolOS V5 Stage 7F1: immutable provider-verified LiveKit metering evidence.
-- Capturing signed event evidence cannot spend any prepaid video credit.
CREATE TABLE "SchoolOSLiveKitEvent"(
 "id" TEXT NOT NULL,
 "providerEventId" TEXT NOT NULL,
 "organizationId" TEXT NOT NULL,
 "meetingId" TEXT NOT NULL,
 "eventType" TEXT NOT NULL,
 "identity" TEXT,
 "participantSid" TEXT,
 "occurredAt" TIMESTAMP(3) NOT NULL,
 "rawSha256" TEXT NOT NULL,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SchoolOSLiveKitEvent_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SchoolOSLiveKitEvent_valid_check" CHECK (
  char_length("providerEventId") BETWEEN 8 AND 191 AND
  "eventType" IN ('participant_joined','participant_left','room_finished') AND
  char_length("rawSha256")=64 AND "rawSha256"~'^[0-9a-f]{64}$' AND
  ((("eventType" IN ('participant_joined','participant_left')) AND
    "identity" IS NOT NULL AND "participantSid" IS NOT NULL AND
    length("identity")>0 AND length("participantSid")>0)
   OR ("eventType"='room_finished' AND "identity" IS NULL AND "participantSid" IS NULL))
 )
);
CREATE UNIQUE INDEX "SchoolOSLiveKitEvent_providerEventId_key"
 ON "SchoolOSLiveKitEvent"("providerEventId");
CREATE INDEX "SchoolOSLiveKitEvent_organizationId_meetingId_occurredAt_idx"
 ON "SchoolOSLiveKitEvent"("organizationId","meetingId","occurredAt");
CREATE INDEX "SchoolOSLiveKitEvent_meetingId_eventType_idx"
 ON "SchoolOSLiveKitEvent"("meetingId","eventType");
ALTER TABLE "SchoolOSLiveKitEvent" ADD CONSTRAINT "SchoolOSLiveKitEvent_organizationId_fkey"
 FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolOSLiveKitEvent" ADD CONSTRAINT "SchoolOSLiveKitEvent_meetingId_fkey"
 FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION schoolos_livekit_evidence_guard_fn()
RETURNS TRIGGER AS $$
DECLARE mapped_org TEXT;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN
  RAISE EXCEPTION 'SCHOOLOS_LIVEKIT_EVIDENCE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 SELECT "organizationId" INTO mapped_org FROM "Meeting" WHERE "id"=NEW."meetingId";
 IF mapped_org IS NULL OR mapped_org<>NEW."organizationId" THEN
  RAISE EXCEPTION 'SCHOOLOS_LIVEKIT_TENANT_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF NEW."eventType"<>'room_finished' AND NOT EXISTS(
  SELECT 1 FROM "MeetingParticipant" p WHERE p."meetingId"=NEW."meetingId"
   AND p."organizationId"=NEW."organizationId" AND p."userId"=NEW."identity"
 ) THEN
  RAISE EXCEPTION 'SCHOOLOS_LIVEKIT_PARTICIPANT_MISMATCH' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SchoolOSLiveKitEvent_guard"
 BEFORE INSERT OR UPDATE OR DELETE ON "SchoolOSLiveKitEvent"
 FOR EACH ROW EXECUTE FUNCTION schoolos_livekit_evidence_guard_fn();
