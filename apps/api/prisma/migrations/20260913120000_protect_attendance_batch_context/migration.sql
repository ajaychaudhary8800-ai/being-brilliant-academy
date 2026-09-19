-- Attendance stores its historical academic context through Batch. Extend
-- the existing validation-only Batch guard to legacy Attendance rows.
CREATE OR REPLACE FUNCTION "protect_enrolled_batch_academic_structure"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."branchId", NEW."academicSessionId", NEW."courseId")
       IS DISTINCT FROM
     (OLD."branchId", OLD."academicSessionId", OLD."courseId")
     AND (
       EXISTS (
         SELECT 1 FROM "StudentAcademicEnrollment" enrollment
          WHERE enrollment."organizationId" = OLD."organizationId"
            AND enrollment."batchId" = OLD."id"
       )
       OR EXISTS (
         SELECT 1 FROM "Attendance" attendance
          WHERE attendance."organizationId" = OLD."organizationId"
            AND attendance."batchId" = OLD."id"
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'Batch_academic_structure_locked',
      MESSAGE = 'A Batch with academic history cannot change branch, course, or academic session';
  END IF;
  RETURN NEW;
END $$;
