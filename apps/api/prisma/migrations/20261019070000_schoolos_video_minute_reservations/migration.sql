-- Stage 7F3: allow bounded video-minute reservations in the same transactional
-- prepaid balance that AI reservations use. Old AI one-unit guard remains intact.
ALTER TABLE "SchoolOSUsageReservation" DROP CONSTRAINT "SchoolOSUsageReservation_state_check";
ALTER TABLE "SchoolOSUsageReservation" ADD CONSTRAINT "SchoolOSUsageReservation_state_check" CHECK (
  (("metric"='ai_credits' AND "units"=1)
   OR ("metric"='video_minutes' AND "units" BETWEEN 1 AND 240
       AND "requestKey" LIKE 'video-meeting:%'))
  AND char_length("requestKey") BETWEEN 8 AND 120
  AND (
    ("status"='RESERVED' AND "committedAt" IS NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
    OR ("status"='COMMITTED' AND "committedAt" IS NOT NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
    OR ("status"='RELEASED' AND "committedAt" IS NULL AND "releasedAt" IS NOT NULL
        AND char_length("releaseReason") BETWEEN 12 AND 500)
  )
);
-- Preserve identity of signed reservation; finalized rows cannot be reversed.
-- Existing reservation trigger enforces tenant/balance/metric and immutable units.
