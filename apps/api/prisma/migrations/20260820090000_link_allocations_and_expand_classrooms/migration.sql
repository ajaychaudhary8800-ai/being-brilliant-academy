CREATE TYPE "ClassroomType" AS ENUM ('CLASSROOM', 'LAB', 'COMPUTER_LAB', 'AUDITORIUM', 'OTHER');

ALTER TABLE "Classroom"
  ADD COLUMN "building" TEXT,
  ADD COLUMN "floor" TEXT,
  ADD COLUMN "type" "ClassroomType" NOT NULL DEFAULT 'CLASSROOM',
  ADD COLUMN "remarks" TEXT;

ALTER TABLE "TeacherAllocation" ADD COLUMN "subjectId" TEXT;

-- Fail before changing allocation data if legacy relationships are ambiguous
-- or inconsistent. These checks deliberately prefer a stopped deployment to
-- guessing at production academic data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Subject"
    GROUP BY "organizationId", lower(btrim("name")) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Teacher allocation backfill blocked: case-insensitive duplicate Subject names exist'; END IF;

  IF EXISTS (
    SELECT 1 FROM "TeacherAllocation" a
    JOIN "Branch" br ON br.id = a."branchId"
    JOIN "AcademicSession" s ON s.id = a."academicSessionId"
    JOIN "Course" c ON c.id = a."courseId"
    JOIN "Batch" b ON b.id = a."batchId"
    JOIN "TeacherProfile" t ON t.id = a."teacherId"
    WHERE br."organizationId" <> a."organizationId"
       OR s."organizationId" <> a."organizationId"
       OR c."organizationId" <> a."organizationId"
       OR b."organizationId" <> a."organizationId"
       OR t."organizationId" <> a."organizationId"
       OR b."branchId" <> a."branchId" OR b."courseId" <> a."courseId"
       OR b."academicSessionId" <> a."academicSessionId" OR t."branchId" <> a."branchId"
  ) OR EXISTS (
    SELECT 1 FROM "TeacherAllocation" a
    JOIN "Subject" sub ON sub."organizationId" = a."organizationId"
      AND lower(btrim(sub."name")) = lower(btrim(a."subjectName"))
    JOIN "CourseSubject" cs ON cs."courseId" = a."courseId" AND cs."subjectId" = sub.id
    WHERE cs."organizationId" <> a."organizationId"
  ) THEN RAISE EXCEPTION 'Teacher allocation backfill blocked: cross-organization or branch relationship inconsistency exists'; END IF;

  IF EXISTS (
    SELECT 1 FROM "TeacherAllocation" a JOIN "Subject" s
      ON s.id = 'c' || substr(md5(a."organizationId" || '|' || lower(btrim(a."subjectName"))), 1, 24)
    WHERE s."organizationId" <> a."organizationId" OR lower(btrim(s."name")) <> lower(btrim(a."subjectName"))
  ) OR EXISTS (
    SELECT 1 FROM "TeacherAllocation" a JOIN "Subject" s
      ON s."code" = 'TA-' || upper(substr(md5(a."organizationId" || '|' || lower(btrim(a."subjectName"))), 1, 12))
    WHERE s."organizationId" <> a."organizationId" OR lower(btrim(s."name")) <> lower(btrim(a."subjectName"))
  ) THEN RAISE EXCEPTION 'Teacher allocation backfill blocked: generated Subject identifier or code collision exists'; END IF;
END $$;

INSERT INTO "Subject" ("id", "organizationId", "name", "code", "createdAt")
SELECT 'c' || substr(md5(a."organizationId" || '|' || lower(btrim(a."subjectName"))), 1, 24),
       a."organizationId",
       min(btrim(a."subjectName")),
       'TA-' || upper(substr(md5(a."organizationId" || '|' || lower(btrim(a."subjectName"))), 1, 12)),
       CURRENT_TIMESTAMP
FROM "TeacherAllocation" a
WHERE NOT EXISTS (
  SELECT 1 FROM "Subject" s
  WHERE s."organizationId" = a."organizationId"
    AND lower(btrim(s."name")) = lower(btrim(a."subjectName"))
)
GROUP BY a."organizationId", lower(btrim(a."subjectName"));

UPDATE "TeacherAllocation" a
SET "subjectId" = s."id"
FROM "Subject" s
WHERE s."organizationId" = a."organizationId"
  AND lower(btrim(s."name")) = lower(btrim(a."subjectName"));

INSERT INTO "CourseSubject" ("organizationId", "courseId", "subjectId", "position", "isActive")
SELECT DISTINCT a."organizationId", a."courseId", a."subjectId", 0, true
FROM "TeacherAllocation" a
WHERE a."subjectId" IS NOT NULL
-- Existing inactive course-subject relationships are intentional business
-- state and must not be reactivated by this backfill.
ON CONFLICT ("courseId", "subjectId") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TeacherAllocation" WHERE "subjectId" IS NULL) THEN
    RAISE EXCEPTION 'Teacher allocation backfill blocked: one or more subjects could not be resolved exactly once';
  END IF;
END $$;

ALTER TABLE "TeacherAllocation" ALTER COLUMN "subjectId" SET NOT NULL;
ALTER TABLE "TeacherAllocation" ADD CONSTRAINT "TeacherAllocation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "TeacherAllocation_organizationId_subjectId_idx" ON "TeacherAllocation"("organizationId", "subjectId");
