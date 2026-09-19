-- Student academic placement foundation.
--
-- Rolling-deployment safety: this migration deliberately does not install a
-- StudentProfile/StudentAcademicEnrollment synchronization or consistency
-- trigger. Production writers are changed to dual-write in the application;
-- a database-enforced projection invariant is deferred to a later hardening
-- migration after old application versions can no longer be running.

-- Fail before the backfill (and before any persistent DDL) if legacy placement
-- data cannot be represented without guessing.
DO $$
DECLARE
  contradiction text;
  course_less_count bigint;
BEGIN
  SELECT format('StudentProfile %s references missing Batch %s', sp."id", sp."batchId")
    INTO contradiction
    FROM "StudentProfile" sp
    LEFT JOIN "Batch" b ON b."id" = sp."batchId"
   WHERE b."id" IS NULL
   LIMIT 1;

  IF contradiction IS NULL THEN
    SELECT format('StudentProfile %s organization %s differs from Batch %s organization %s', sp."id", sp."organizationId", b."id", b."organizationId")
      INTO contradiction
      FROM "StudentProfile" sp
      JOIN "Batch" b ON b."id" = sp."batchId"
     WHERE sp."organizationId" IS DISTINCT FROM b."organizationId"
     LIMIT 1;
  END IF;

  IF contradiction IS NULL THEN
    SELECT format('StudentProfile %s branch %s differs from Batch %s branch %s', sp."id", sp."branchId", b."id", b."branchId")
      INTO contradiction
      FROM "StudentProfile" sp
      JOIN "Batch" b ON b."id" = sp."batchId"
     WHERE sp."branchId" IS DISTINCT FROM b."branchId"
     LIMIT 1;
  END IF;

  IF contradiction IS NULL THEN
    SELECT format('StudentProfile %s session %s differs from Batch %s session %s', sp."id", sp."academicSessionId", b."id", b."academicSessionId")
      INTO contradiction
      FROM "StudentProfile" sp
      JOIN "Batch" b ON b."id" = sp."batchId"
     WHERE sp."academicSessionId" IS DISTINCT FROM b."academicSessionId"
     LIMIT 1;
  END IF;

  IF contradiction IS NULL THEN
    SELECT format('Batch %s references missing or cross-tenant AcademicSession %s', b."id", b."academicSessionId")
      INTO contradiction
      FROM "Batch" b
      LEFT JOIN "AcademicSession" s
        ON s."id" = b."academicSessionId"
       AND s."organizationId" = b."organizationId"
     WHERE s."id" IS NULL
     LIMIT 1;
  END IF;

  IF contradiction IS NULL THEN
    SELECT format('Batch %s references missing or cross-tenant Branch %s', b."id", b."branchId")
      INTO contradiction
      FROM "Batch" b
      LEFT JOIN "Branch" br
        ON br."id" = b."branchId"
       AND br."organizationId" = b."organizationId"
     WHERE br."id" IS NULL
     LIMIT 1;
  END IF;

  IF contradiction IS NULL THEN
    SELECT format('Batch %s references missing or cross-tenant Course %s', b."id", b."courseId")
      INTO contradiction
      FROM "Batch" b
      LEFT JOIN "Course" c
        ON c."id" = b."courseId"
       AND c."organizationId" = b."organizationId"
     WHERE b."courseId" IS NOT NULL
       AND c."id" IS NULL
     LIMIT 1;
  END IF;

  IF contradiction IS NULL THEN
    SELECT format('StudentProfile %s has an empty normalized roll number', sp."id")
      INTO contradiction
      FROM "StudentProfile" sp
     WHERE length(btrim(sp."rollNo")) = 0
     LIMIT 1;
  END IF;

  IF contradiction IS NULL THEN
    SELECT format('Batch %s has duplicate normalized active roll number %s', duplicates."batchId", duplicates."rollNo")
      INTO contradiction
      FROM (
        SELECT sp."organizationId", sp."batchId", upper(btrim(sp."rollNo")) AS "rollNo"
          FROM "StudentProfile" sp
         GROUP BY sp."organizationId", sp."batchId", upper(btrim(sp."rollNo"))
        HAVING count(*) > 1
      ) duplicates
     LIMIT 1;
  END IF;

  IF contradiction IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Student academic enrollment preflight failed: ' || contradiction;
  END IF;

  SELECT count(*)
    INTO course_less_count
    FROM "StudentProfile" sp
    JOIN "Batch" b ON b."id" = sp."batchId"
   WHERE b."courseId" IS NULL;

  IF course_less_count > 0 THEN
    RAISE NOTICE 'Student academic enrollment backfill will preserve % course-less legacy placement(s) as BACKFILL rows', course_less_count;
  END IF;
END $$;

CREATE TYPE "StudentAcademicEnrollmentStatus" AS ENUM ('ACTIVE', 'CLOSED', 'CANCELLED');
CREATE TYPE "StudentAcademicEnrollmentSource" AS ENUM ('ADMISSION', 'IMPORT', 'BACKFILL', 'PROMOTION', 'RETENTION', 'TRANSFER', 'ADMIN_CHANGE');

CREATE UNIQUE INDEX "AcademicSession_organizationId_id_key" ON "AcademicSession"("organizationId", "id");
CREATE UNIQUE INDEX "User_organizationId_id_key" ON "User"("organizationId", "id");
CREATE UNIQUE INDEX "Branch_organizationId_id_key" ON "Branch"("organizationId", "id");
CREATE UNIQUE INDEX "Course_organizationId_id_key" ON "Course"("organizationId", "id");
CREATE UNIQUE INDEX "Batch_organizationId_id_key" ON "Batch"("organizationId", "id");
CREATE UNIQUE INDEX "Batch_enrollment_scope_key" ON "Batch"("organizationId", "id", "branchId", "academicSessionId");
CREATE UNIQUE INDEX "Batch_enrollment_course_scope_key" ON "Batch"("organizationId", "id", "courseId");
CREATE UNIQUE INDEX "StudentProfile_organizationId_id_key" ON "StudentProfile"("organizationId", "id");

CREATE TABLE "StudentAcademicEnrollment" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "academicSessionId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "courseId" TEXT,
  "batchId" TEXT NOT NULL,
  "rollNo" TEXT NOT NULL,
  "status" "StudentAcademicEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "StudentAcademicEnrollmentSource" NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StudentAcademicEnrollment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentAcademicEnrollment_lifecycle_check" CHECK (
    ("status" = 'ACTIVE' AND "effectiveTo" IS NULL)
    -- Placement bounds are civil dates. Same-day CLOSED history is valid;
    -- use placement context or operation timestamps when intra-day order matters.
    OR ("status" = 'CLOSED' AND "effectiveTo" IS NOT NULL AND "effectiveTo" >= "effectiveFrom")
    OR ("status" = 'CANCELLED' AND "effectiveTo" = "effectiveFrom")
  ),
  CONSTRAINT "StudentAcademicEnrollment_course_source_check" CHECK (
    "courseId" IS NOT NULL OR "source" = 'BACKFILL'
  ),
  CONSTRAINT "StudentAcademicEnrollment_creator_source_check" CHECK (
    ("source" = 'BACKFILL' AND "createdById" IS NULL)
    OR ("source" <> 'BACKFILL' AND "createdById" IS NOT NULL)
  ),
  CONSTRAINT "StudentAcademicEnrollment_roll_check" CHECK (
    length(btrim("rollNo")) BETWEEN 1 AND 30
  )
);

ALTER TABLE "StudentAcademicEnrollment"
  ADD CONSTRAINT "SAE_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SAE_student_fkey" FOREIGN KEY ("organizationId", "studentId") REFERENCES "StudentProfile"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SAE_session_fkey" FOREIGN KEY ("organizationId", "academicSessionId") REFERENCES "AcademicSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SAE_branch_fkey" FOREIGN KEY ("organizationId", "branchId") REFERENCES "Branch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SAE_course_fkey" FOREIGN KEY ("organizationId", "courseId") REFERENCES "Course"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SAE_batch_scope_fkey" FOREIGN KEY ("organizationId", "batchId", "branchId", "academicSessionId") REFERENCES "Batch"("organizationId", "id", "branchId", "academicSessionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SAE_batch_course_fkey" FOREIGN KEY ("organizationId", "batchId", "courseId") REFERENCES "Batch"("organizationId", "id", "courseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SAE_creator_fkey" FOREIGN KEY ("organizationId", "createdById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- PostgreSQL composite foreign keys do not enforce null parity. This trigger
-- only validates the authoritative Batch tuple; it never writes another row.
CREATE FUNCTION "validate_student_academic_enrollment_batch"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  authoritative "Batch"%ROWTYPE;
BEGIN
  SELECT * INTO authoritative
    FROM "Batch"
   WHERE "organizationId" = NEW."organizationId"
     AND "id" = NEW."batchId";

  IF NOT FOUND
     OR NEW."branchId" IS DISTINCT FROM authoritative."branchId"
     OR NEW."academicSessionId" IS DISTINCT FROM authoritative."academicSessionId"
     OR NEW."courseId" IS DISTINCT FROM authoritative."courseId" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'StudentAcademicEnrollment_batch_tuple_check',
      MESSAGE = 'Student academic enrollment must match its authoritative Batch tuple';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "StudentAcademicEnrollment_batch_tuple_check"
BEFORE INSERT OR UPDATE OF "organizationId", "batchId", "branchId", "academicSessionId", "courseId"
ON "StudentAcademicEnrollment"
FOR EACH ROW EXECUTE FUNCTION "validate_student_academic_enrollment_batch"();

-- Keep the authoritative tuple immutable once any academic history references
-- the Batch. This is also validation-only and closes nullable Course-FK parity.
CREATE FUNCTION "protect_enrolled_batch_academic_structure"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."branchId", NEW."academicSessionId", NEW."courseId")
       IS DISTINCT FROM
     (OLD."branchId", OLD."academicSessionId", OLD."courseId")
     AND EXISTS (
       SELECT 1 FROM "StudentAcademicEnrollment" enrollment
        WHERE enrollment."organizationId" = OLD."organizationId"
          AND enrollment."batchId" = OLD."id"
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'Batch_academic_structure_locked',
      MESSAGE = 'A Batch with academic enrollment history cannot change branch, course, or academic session';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Batch_academic_structure_locked"
BEFORE UPDATE OF "branchId", "academicSessionId", "courseId"
ON "Batch"
FOR EACH ROW EXECUTE FUNCTION "protect_enrolled_batch_academic_structure"();

-- Canonicalize only the compatibility string. IDs and Batch tuple were proven
-- consistent by the preflight and are never guessed or rewritten here.
UPDATE "StudentProfile" sp
   SET "academicSession" = s."name",
       "updatedAt" = CURRENT_TIMESTAMP
  FROM "AcademicSession" s
 WHERE s."organizationId" = sp."organizationId"
   AND s."id" = sp."academicSessionId"
   AND sp."academicSession" IS DISTINCT FROM s."name";

INSERT INTO "StudentAcademicEnrollment" (
  "organizationId", "id", "studentId", "academicSessionId", "branchId",
  "courseId", "batchId", "rollNo", "status", "source", "effectiveFrom",
  "effectiveTo", "createdById", "createdAt", "updatedAt"
)
SELECT
  sp."organizationId",
  'c' || substring(md5(sp."id" || ':academic-enrollment:backfill') from 1 for 24),
  sp."id",
  b."academicSessionId",
  b."branchId",
  b."courseId",
  b."id",
  upper(btrim(sp."rollNo")),
  'ACTIVE'::"StudentAcademicEnrollmentStatus",
  'BACKFILL'::"StudentAcademicEnrollmentSource",
  GREATEST(
    sp."admissionDate",
    s."startsAt",
    ((b."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE o."timezone")::date
  ),
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "StudentProfile" sp
JOIN "Batch" b ON b."id" = sp."batchId" AND b."organizationId" = sp."organizationId"
JOIN "AcademicSession" s ON s."id" = b."academicSessionId" AND s."organizationId" = b."organizationId"
JOIN "Organization" o ON o."id" = sp."organizationId";

CREATE UNIQUE INDEX "StudentAcademicEnrollment_organizationId_id_key"
  ON "StudentAcademicEnrollment"("organizationId", "id");
CREATE UNIQUE INDEX "StudentAcademicEnrollment_one_active_student_key"
  ON "StudentAcademicEnrollment"("organizationId", "studentId")
  WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "StudentAcademicEnrollment_active_batch_roll_key"
  ON "StudentAcademicEnrollment"("organizationId", "batchId", upper(btrim("rollNo")))
  WHERE "status" = 'ACTIVE';
CREATE INDEX "StudentAcademicEnrollment_student_status_idx"
  ON "StudentAcademicEnrollment"("organizationId", "studentId", "status");
CREATE INDEX "StudentAcademicEnrollment_history_idx"
  ON "StudentAcademicEnrollment"("organizationId", "studentId", "effectiveFrom", "createdAt");
CREATE INDEX "StudentAcademicEnrollment_scope_status_idx"
  ON "StudentAcademicEnrollment"("organizationId", "academicSessionId", "branchId", "batchId", "status");
CREATE INDEX "StudentAcademicEnrollment_batch_status_idx"
  ON "StudentAcademicEnrollment"("organizationId", "batchId", "status");
