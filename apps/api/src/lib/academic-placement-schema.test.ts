import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../prisma/migrations/20260913100000_add_student_academic_enrollment/migration.sql", import.meta.url), "utf8");
const attendanceGuardMigration = readFileSync(new URL("../../prisma/migrations/20260913120000_protect_attendance_batch_context/migration.sql", import.meta.url), "utf8");

test("StudentAcademicEnrollment schema exposes the approved authoritative history model", () => {
  assert.match(schema, /enum StudentAcademicEnrollmentStatus \{\s+ACTIVE\s+CLOSED\s+CANCELLED\s+\}/);
  assert.match(schema, /enum StudentAcademicEnrollmentSource \{[\s\S]*ADMISSION[\s\S]*IMPORT[\s\S]*BACKFILL[\s\S]*PROMOTION[\s\S]*RETENTION[\s\S]*TRANSFER[\s\S]*ADMIN_CHANGE[\s\S]*\}/);
  assert.match(schema, /model StudentAcademicEnrollment \{/);
  assert.match(schema, /effectiveFrom\s+DateTime\s+@db\.Date/);
  assert.match(schema, /effectiveTo\s+DateTime\?\s+@db\.Date/);
  assert.match(schema, /batch\s+Batch\s+@relation\("StudentAcademicEnrollmentBatchScope", fields: \[organizationId, batchId, branchId, academicSessionId\], references: \[organizationId, id, branchId, academicSessionId\]/);
  for (const parent of ["AcademicSession", "User", "Branch", "Course", "Batch", "StudentProfile"]) {
    const block = schema.match(new RegExp(`model ${parent} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
    assert.match(block, /@@unique\(\[organizationId, id\]\)/, `${parent} must expose a tenant composite candidate key`);
  }
  assert.doesNotMatch(schema, /currentAcademicEnrollmentId|previousEnrollmentId/);
});

test("academic placement migration preflights, backfills and hardens without a projection-writing trigger", () => {
  const preflight = migration.indexOf("Student academic enrollment preflight failed");
  const backfill = migration.indexOf('INSERT INTO "StudentAcademicEnrollment"');
  assert.ok(preflight >= 0 && preflight < backfill);
  for (const evidence of [
    /references missing Batch/,
    /organization %s differs from Batch/,
    /branch %s differs from Batch/,
    /session %s differs from Batch/,
    /missing or cross-tenant AcademicSession/,
    /missing or cross-tenant Branch/,
    /missing or cross-tenant Course/,
    /empty normalized roll number/,
    /duplicate normalized active roll number/,
  ]) assert.match(migration, evidence);
  assert.match(migration, /RAISE NOTICE 'Student academic enrollment backfill will preserve % course-less legacy placement/);
  assert.match(migration, /GREATEST\([\s\S]*sp\."admissionDate"[\s\S]*s\."startsAt"[\s\S]*o\."timezone"[\s\S]*\)/);
  assert.match(migration, /'BACKFILL'::"StudentAcademicEnrollmentSource"/);
  assert.match(migration, /"courseId" IS NOT NULL OR "source" = 'BACKFILL'/);
  assert.match(migration, /"source" = 'BACKFILL' AND "createdById" IS NULL/);
  assert.match(migration, /"status" = 'ACTIVE' AND "effectiveTo" IS NULL/);
  assert.match(migration, /Same-day CLOSED history is valid[\s\S]*"status" = 'CLOSED'[\s\S]*"effectiveTo" >= "effectiveFrom"/);
  assert.match(migration, /"status" = 'CANCELLED' AND "effectiveTo" = "effectiveFrom"/);
  assert.match(migration, /StudentAcademicEnrollment_one_active_student_key[\s\S]*WHERE "status" = 'ACTIVE'/);
  assert.match(migration, /StudentAcademicEnrollment_active_batch_roll_key[\s\S]*upper\(btrim\("rollNo"\)\)[\s\S]*WHERE "status" = 'ACTIVE'/);
  assert.match(migration, /validate_student_academic_enrollment_batch/);
  assert.match(migration, /NEW\."courseId" IS DISTINCT FROM authoritative\."courseId"/);
  assert.match(migration, /CREATE TRIGGER "Batch_academic_structure_locked"/);
  assert.match(migration, /protect_enrolled_batch_academic_structure/);
  assert.doesNotMatch(migration, /UPDATE\s+"StudentAcademicEnrollment"[\s\S]*StudentProfile|UPDATE\s+"StudentProfile"[\s\S]*CREATE TRIGGER/i);
  assert.doesNotMatch(migration, /FeePlan|StudentFeeAssignment|FeePayment|FeePaymentOffset|FeePlanComponent/);
});

test("attendance history extends the validation-only Batch structural guard", () => {
  assert.match(attendanceGuardMigration, /CREATE OR REPLACE FUNCTION "protect_enrolled_batch_academic_structure"/);
  assert.match(attendanceGuardMigration, /FROM "Attendance" attendance/);
  assert.match(attendanceGuardMigration, /attendance\."organizationId" = OLD\."organizationId"/);
  assert.match(attendanceGuardMigration, /attendance\."batchId" = OLD\."id"/);
  assert.match(attendanceGuardMigration, /Batch_academic_structure_locked/);
  assert.doesNotMatch(attendanceGuardMigration, /UPDATE\s+"Attendance"|DELETE\s+FROM\s+"Attendance"/i);
});
