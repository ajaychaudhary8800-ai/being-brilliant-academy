ALTER TABLE "LearningTest"
  ADD COLUMN IF NOT EXISTS "deliveryPolicy" JSONB;

ALTER TABLE "LearningTestAttempt"
  ADD COLUMN IF NOT EXISTS "deliverySeed" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryPolicySnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "accommodationSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "clientInstanceId" TEXT,
  ADD COLUMN IF NOT EXISTS "resumeCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastResumedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "offlineLeaseUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "LearningTestIntegrityEvent" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'INFO',
  "details" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningTestIntegrityEvent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LearningTestIntegrityEvent_attemptId_fkey'
  ) THEN
    ALTER TABLE "LearningTestIntegrityEvent"
      ADD CONSTRAINT "LearningTestIntegrityEvent_attemptId_fkey"
      FOREIGN KEY ("attemptId") REFERENCES "LearningTestAttempt"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LearningTestIntegrityEvent_organizationId_attemptId_occurredAt_idx"
  ON "LearningTestIntegrityEvent"("organizationId", "attemptId", "occurredAt");

CREATE INDEX IF NOT EXISTS "LearningTestIntegrityEvent_organizationId_type_occurredAt_idx"
  ON "LearningTestIntegrityEvent"("organizationId", "type", "occurredAt");
