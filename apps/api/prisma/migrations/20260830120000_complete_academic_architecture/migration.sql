-- Additive academic architecture upgrade. Existing identifiers and legacy
-- TeacherAllocation.subjectName values are deliberately preserved.

CREATE TYPE "SubjectStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "SubjectLegacyReviewStatus" AS ENUM ('CONFIRMED', 'REVIEW_REQUIRED');
CREATE TYPE "GroupLabelType" AS ENUM ('SECTION', 'BATCH', 'GROUP', 'CUSTOM');
CREATE TYPE "TimetablePeriodType" AS ENUM ('TEACHING', 'BREAK');
CREATE TYPE "TeacherDutyType" AS ENUM ('ADMIN_DUTY', 'EXAM_DUTY', 'MEETING', 'COUNSELLING', 'OTHER_DUTY');
CREATE TYPE "SubstitutionStatus" AS ENUM ('ASSIGNED', 'COMPLETED', 'CANCELLED');

ALTER TABLE "Organization"
  ADD COLUMN "groupLabelType" "GroupLabelType" NOT NULL DEFAULT 'BATCH',
  ADD COLUMN "customGroupLabel" TEXT;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_customGroupLabel_check" CHECK ("groupLabelType" <> 'CUSTOM' OR length(btrim("customGroupLabel")) BETWEEN 2 AND 40);

ALTER TABLE "Subject"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "status" "SubjectStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "legacyReviewStatus" "SubjectLegacyReviewStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Subjects created by the previous exact-string compatibility migration are
-- retained but require an administrator to confirm their semantic meaning.
UPDATE "Subject"
SET "legacyReviewStatus" = 'REVIEW_REQUIRED'
WHERE "code" LIKE 'TA-%';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Subject"
    GROUP BY "organizationId", lower(btrim("name"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Subject Master upgrade blocked: case-insensitive duplicate subject names exist; review preflight output without merging records';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Subject"
    GROUP BY "organizationId", upper(btrim("code"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Subject Master upgrade blocked: duplicate tenant-scoped subject codes exist';
  END IF;
END $$;

DROP INDEX IF EXISTS "Subject_code_key";
CREATE UNIQUE INDEX "Subject_organizationId_code_key" ON "Subject"("organizationId", "code");
CREATE UNIQUE INDEX "Subject_organizationId_normalized_name_key" ON "Subject"("organizationId", lower(btrim("name")));
CREATE INDEX "Subject_organizationId_status_idx" ON "Subject"("organizationId", "status");
CREATE INDEX "Subject_organizationId_name_idx" ON "Subject"("organizationId", "name");
DROP INDEX IF EXISTS "Subject_organizationId_idx";

ALTER TABLE "TeacherProfile"
  ADD COLUMN "maxPeriodsPerDay" INTEGER,
  ADD COLUMN "maxPeriodsPerWeek" INTEGER,
  ADD CONSTRAINT "TeacherProfile_maxPeriodsPerDay_check" CHECK ("maxPeriodsPerDay" IS NULL OR "maxPeriodsPerDay" BETWEEN 1 AND 50),
  ADD CONSTRAINT "TeacherProfile_maxPeriodsPerWeek_check" CHECK ("maxPeriodsPerWeek" IS NULL OR "maxPeriodsPerWeek" BETWEEN 1 AND 300);

CREATE TABLE "TeacherSubject" (
  "organizationId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherSubject_pkey" PRIMARY KEY ("teacherId", "subjectId"),
  CONSTRAINT "TeacherSubject_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TeacherSubject_organizationId_subjectId_idx" ON "TeacherSubject"("organizationId", "subjectId");
CREATE INDEX "TeacherSubject_organizationId_teacherId_idx" ON "TeacherSubject"("organizationId", "teacherId");

-- Exact normalized links already established on TeacherAllocation are safe to
-- reuse. This does not parse, split, merge, or rename any legacy subject text.
INSERT INTO "TeacherSubject" ("organizationId", "teacherId", "subjectId", "createdAt", "updatedAt")
SELECT DISTINCT a."organizationId", a."teacherId", a."subjectId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TeacherAllocation" a
JOIN "TeacherProfile" t ON t.id = a."teacherId" AND t."organizationId" = a."organizationId"
JOIN "Subject" s ON s.id = a."subjectId" AND s."organizationId" = a."organizationId"
ON CONFLICT ("teacherId", "subjectId") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "TeacherAllocation"
    WHERE status = 'ACTIVE'
    GROUP BY "organizationId", "teacherId", "subjectId", "batchId", "academicSessionId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Teacher Allocation upgrade blocked: duplicate active normalized allocations exist; deactivate historical duplicates explicitly';
  END IF;
END $$;
CREATE UNIQUE INDEX "TeacherAllocation_active_subject_scope_key"
  ON "TeacherAllocation"("organizationId", "teacherId", "subjectId", "batchId", "academicSessionId")
  WHERE status = 'ACTIVE';

CREATE TABLE "TimetablePeriod" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "academicSessionId" TEXT NOT NULL,
  "day" "TimetableDay" NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "type" "TimetablePeriodType" NOT NULL DEFAULT 'TEACHING',
  "label" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimetablePeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TimetablePeriod_time_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute"),
  CONSTRAINT "TimetablePeriod_period_check" CHECK ("periodNumber" BETWEEN 1 AND 50),
  CONSTRAINT "TimetablePeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TimetablePeriod_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TimetablePeriod_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TimetablePeriod_branchId_academicSessionId_day_periodNumber_key" ON "TimetablePeriod"("branchId", "academicSessionId", "day", "periodNumber");
CREATE INDEX "TimetablePeriod_organizationId_branchId_academicSessionId_day_idx" ON "TimetablePeriod"("organizationId", "branchId", "academicSessionId", "day");

-- Preserve existing schedules while establishing an editable period template.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Timetable"
    GROUP BY "organizationId", "branchId", "academicSessionId", "day", "periodNumber"
    HAVING count(DISTINCT ("startMinute", "endMinute")) > 1
  ) THEN
    RAISE EXCEPTION 'Timetable period backfill blocked: one period number has inconsistent times in the same branch, session and day';
  END IF;
END $$;
INSERT INTO "TimetablePeriod" ("id", "organizationId", "branchId", "academicSessionId", "day", "periodNumber", "startMinute", "endMinute", "type", "isActive", "createdAt", "updatedAt")
SELECT 'c' || substr(md5(t."organizationId" || '|' || t."branchId" || '|' || t."academicSessionId" || '|' || t."day"::text || '|' || t."periodNumber"::text), 1, 24),
       t."organizationId", t."branchId", t."academicSessionId", t."day", t."periodNumber",
       min(t."startMinute"), min(t."endMinute"), 'TEACHING', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Timetable" t
GROUP BY t."organizationId", t."branchId", t."academicSessionId", t."day", t."periodNumber"
ON CONFLICT ("branchId", "academicSessionId", "day", "periodNumber") DO NOTHING;

CREATE TABLE "TeacherDuty" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "academicSessionId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "type" "TeacherDutyType" NOT NULL,
  "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherDuty_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeacherDuty_time_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute"),
  CONSTRAINT "TeacherDuty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherDuty_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherDuty_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherDuty_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TeacherDuty_organizationId_branchId_date_idx" ON "TeacherDuty"("organizationId", "branchId", "date");
CREATE INDEX "TeacherDuty_organizationId_teacherId_date_idx" ON "TeacherDuty"("organizationId", "teacherId", "date");

CREATE TABLE "TeacherSubstitution" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "academicSessionId" TEXT NOT NULL,
  "timetableId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "originalTeacherId" TEXT NOT NULL,
  "substituteTeacherId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "reason" TEXT,
  "status" "SubstitutionStatus" NOT NULL DEFAULT 'ASSIGNED',
  "approvedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherSubstitution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeacherSubstitution_different_teacher_check" CHECK ("originalTeacherId" <> "substituteTeacherId"),
  CONSTRAINT "TeacherSubstitution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubstitution_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubstitution_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubstitution_timetableId_fkey" FOREIGN KEY ("timetableId") REFERENCES "Timetable"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubstitution_originalTeacherId_fkey" FOREIGN KEY ("originalTeacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubstitution_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubstitution_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubstitution_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubstitution_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TeacherSubstitution_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Cancelled assignments remain as audit history and do not prevent an
-- authorized administrator from assigning a replacement for that occurrence.
CREATE UNIQUE INDEX "TeacherSubstitution_active_timetable_date_key" ON "TeacherSubstitution"("timetableId", "date")
  WHERE status IN ('ASSIGNED', 'COMPLETED');
CREATE INDEX "TeacherSubstitution_timetableId_date_idx" ON "TeacherSubstitution"("timetableId", "date");
CREATE INDEX "TeacherSubstitution_organizationId_branchId_date_status_idx" ON "TeacherSubstitution"("organizationId", "branchId", "date", "status");
CREATE INDEX "TeacherSubstitution_organizationId_substituteTeacherId_date_idx" ON "TeacherSubstitution"("organizationId", "substituteTeacherId", "date");
CREATE INDEX "TeacherSubstitution_organizationId_originalTeacherId_date_idx" ON "TeacherSubstitution"("organizationId", "originalTeacherId", "date");
