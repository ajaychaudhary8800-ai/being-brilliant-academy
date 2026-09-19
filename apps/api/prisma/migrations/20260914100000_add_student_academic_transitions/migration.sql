CREATE TYPE "StudentAcademicTransitionType" AS ENUM ('PROMOTED', 'RETAINED', 'TRANSFERRED', 'LEFT', 'GRADUATED');

CREATE TABLE "StudentAcademicTransition" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "type" "StudentAcademicTransitionType" NOT NULL,
  "fromEnrollmentId" TEXT NOT NULL,
  "toEnrollmentId" TEXT,
  "effectiveDate" DATE NOT NULL,
  "reason" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentAcademicTransition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentAcademicTransition_organizationId_id_key"
  ON "StudentAcademicTransition"("organizationId", "id");
CREATE UNIQUE INDEX "StudentAcademicTransition_source_key"
  ON "StudentAcademicTransition"("organizationId", "fromEnrollmentId");
CREATE UNIQUE INDEX "StudentAcademicTransition_destination_key"
  ON "StudentAcademicTransition"("organizationId", "toEnrollmentId");
CREATE INDEX "StudentAcademicTransition_history_idx"
  ON "StudentAcademicTransition"("organizationId", "studentId", "effectiveDate", "createdAt");
CREATE UNIQUE INDEX "StudentAcademicEnrollment_organizationId_studentId_id_key"
  ON "StudentAcademicEnrollment"("organizationId", "studentId", "id");

ALTER TABLE "StudentAcademicTransition"
  ADD CONSTRAINT "StudentAcademicTransition_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "StudentAcademicTransition_student_fkey"
    FOREIGN KEY ("organizationId", "studentId") REFERENCES "StudentProfile"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "StudentAcademicTransition_fromEnrollment_fkey"
    FOREIGN KEY ("organizationId", "studentId", "fromEnrollmentId") REFERENCES "StudentAcademicEnrollment"("organizationId", "studentId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "StudentAcademicTransition_toEnrollment_fkey"
    FOREIGN KEY ("organizationId", "studentId", "toEnrollmentId") REFERENCES "StudentAcademicEnrollment"("organizationId", "studentId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "StudentAcademicTransition_createdBy_fkey"
    FOREIGN KEY ("organizationId", "createdById") REFERENCES "User"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "StudentAcademicTransition"
  ADD CONSTRAINT "StudentAcademicTransition_destination_type_check"
    CHECK (("type" IN ('PROMOTED', 'RETAINED', 'TRANSFERRED') AND "toEnrollmentId" IS NOT NULL)
      OR ("type" IN ('LEFT', 'GRADUATED') AND "toEnrollmentId" IS NULL)),
  ADD CONSTRAINT "StudentAcademicTransition_distinct_enrollments_check"
    CHECK ("toEnrollmentId" IS NULL OR "toEnrollmentId" <> "fromEnrollmentId");

CREATE OR REPLACE FUNCTION "StudentAcademicTransition_immutable_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'StudentAcademicTransition rows are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "StudentAcademicTransition_immutable"
  BEFORE UPDATE OR DELETE ON "StudentAcademicTransition"
  FOR EACH ROW EXECUTE FUNCTION "StudentAcademicTransition_immutable_fn"();
