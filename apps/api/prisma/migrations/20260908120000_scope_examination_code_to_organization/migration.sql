-- The existing global code index guarantees this organization-scoped index can
-- be created without encountering exact duplicate values in current data.
BEGIN;

CREATE UNIQUE INDEX "Examination_organizationId_code_key"
ON "Examination"("organizationId", "code");

-- Exam codes are business identifiers within an organization, not globally.
DROP INDEX "Examination_code_key";

-- An examination's primary key is its event identity. This former constraint
-- incorrectly prevented multiple exams of the same type for one subject/session.
DROP INDEX "Examination_batchId_subjectId_type_academicSession_key";

COMMIT;
