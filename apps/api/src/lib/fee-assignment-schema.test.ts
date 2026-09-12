import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../prisma/migrations/20260912160000_add_student_fee_assignments/migration.sql", import.meta.url), "utf8");

test("StudentFeeAssignment and generated Fee sources retain the required authoritative invariants", () => {
  assert.match(schema, /model StudentFeeAssignment \{/);
  assert.match(schema, /feePlanFamilyKey\s+String/);
  assert.match(schema, /@@unique\(\[organizationId, studentId, academicSessionId, feePlanFamilyKey\]/);
  assert.match(schema, /@@unique\(\[organizationId, id, familyKey, academicSessionId\], map: "FeePlan_assignment_snapshot_key"\)/);
  assert.match(schema, /feePlan\s+FeePlan\s+@relation\(fields: \[organizationId, feePlanId, feePlanFamilyKey, academicSessionId\], references: \[organizationId, id, familyKey, academicSessionId\]/);
  assert.match(schema, /studentFeeAssignmentId\s+String\?/);
  assert.match(schema, /feePlanComponentId\s+String\?/);
  assert.match(migration, /Fee_generated_source_pair_check/);
  assert.match(migration, /CREATE UNIQUE INDEX "FeePlan_assignment_snapshot_key" ON "FeePlan"\("organizationId", "id", "familyKey", "academicSessionId"\);/);
  assert.match(migration, /StudentFeeAssignment_feePlan_snapshot_fkey" FOREIGN KEY \("organizationId", "feePlanId", "feePlanFamilyKey", "academicSessionId"\) REFERENCES "FeePlan"\("organizationId", "id", "familyKey", "academicSessionId"\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "Fee_assignment_component_key" ON "Fee"\("organizationId", "studentFeeAssignmentId", "feePlanComponentId"\)\s+WHERE "studentFeeAssignmentId" IS NOT NULL AND "feePlanComponentId" IS NOT NULL;/);
  assert.doesNotMatch(schema, /@@unique\(\[organizationId, studentFeeAssignmentId, feePlanComponentId\]/);
  assert.doesNotMatch(migration, /StudentFeeAssignment_organizationId_feePlanId_fkey/);
  assert.match(migration, /Fee_organizationId_studentFeeAssignmentId_fkey/);
  assert.match(migration, /Fee_organizationId_feePlanComponentId_fkey/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "Fee_generated_source_lineage_check_fn"/);
  assert.match(migration, /CREATE TRIGGER "Fee_generated_source_lineage_check"/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF "organizationId", "studentFeeAssignmentId", "feePlanComponentId"/);
  assert.match(migration, /SELECT assignment\."feePlanId"\s+INTO assignment_plan_id/);
  assert.match(migration, /SELECT installment\."planId"\s+INTO component_plan_id/);
  assert.match(migration, /assignment_plan_id IS DISTINCT FROM component_plan_id/);
  assert.match(migration, /Fee_generated_source_lineage_check/);
});

test("Batch 2 migration is additive and does not rewrite legacy financial data", () => {
  assert.doesNotMatch(migration, /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UPDATE\s+"Fee"|UPDATE\s+"FeePayment")\b/i);
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+"FeePayment"/i);
  assert.match(migration, /ALTER TABLE "Fee" ADD COLUMN "studentFeeAssignmentId" TEXT;/);
  assert.match(migration, /ALTER TABLE "Fee" ADD COLUMN "feePlanComponentId" TEXT;/);
});
