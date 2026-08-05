CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

ALTER TABLE "StudentProfile"
  ADD COLUMN "rollNo" TEXT,
  ADD COLUMN "gender" "Gender",
  ADD COLUMN "dateOfBirth" DATE,
  ADD COLUMN "motherName" TEXT,
  ADD COLUMN "parentMobile" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "academicSession" TEXT,
  ADD COLUMN "admissionDate" DATE,
  ADD COLUMN "bloodGroup" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "aadhaarNo" TEXT,
  ADD COLUMN "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "remarks" TEXT;

UPDATE "StudentProfile" SET
  "rollNo" = "admissionNo",
  "gender" = 'OTHER',
  "dateOfBirth" = DATE '2000-01-01',
  "motherName" = 'Not provided',
  "parentMobile" = '0000000000',
  "address" = 'Not provided',
  "academicSession" = '2026-27',
  "admissionDate" = CURRENT_DATE;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "StudentProfile" WHERE "batchId" IS NULL) THEN
    RAISE EXCEPTION 'Assign every existing student to a batch before applying Student Management migration';
  END IF;
END $$;

ALTER TABLE "StudentProfile"
  ALTER COLUMN "rollNo" SET NOT NULL,
  ALTER COLUMN "gender" SET NOT NULL,
  ALTER COLUMN "dateOfBirth" SET NOT NULL,
  ALTER COLUMN "motherName" SET NOT NULL,
  ALTER COLUMN "parentMobile" SET NOT NULL,
  ALTER COLUMN "address" SET NOT NULL,
  ALTER COLUMN "academicSession" SET NOT NULL,
  ALTER COLUMN "admissionDate" SET NOT NULL,
  ALTER COLUMN "batchId" SET NOT NULL;

CREATE UNIQUE INDEX "StudentProfile_batchId_rollNo_key" ON "StudentProfile"("batchId", "rollNo");
CREATE UNIQUE INDEX "StudentProfile_aadhaarNo_key" ON "StudentProfile"("aadhaarNo");
CREATE INDEX "StudentProfile_status_idx" ON "StudentProfile"("status");
CREATE INDEX "StudentProfile_academicSession_idx" ON "StudentProfile"("academicSession");
