UPDATE "Organization"
SET "settings" = '{}'::jsonb
WHERE "settings" IS NULL;

ALTER TABLE "Organization"
  ALTER COLUMN "settings" SET DEFAULT '{}'::jsonb,
  ALTER COLUMN "settings" SET NOT NULL;
