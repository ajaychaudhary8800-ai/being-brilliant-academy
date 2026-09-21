-- Add configurable default trial duration to SaaS plans.
-- Zero preserves existing behavior: no automatic trial expiry unless explicitly supplied.
ALTER TABLE "SaaSPlan"
  ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SaaSPlan"
  ADD CONSTRAINT "SaaSPlan_trialDays_check" CHECK ("trialDays" >= 0 AND "trialDays" <= 3650);
