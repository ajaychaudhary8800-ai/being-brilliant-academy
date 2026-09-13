-- Additive student fee assignment and generated-receivable traceability.
-- Existing Fee and FeePayment rows remain unchanged; legacy Fee source columns stay NULL.
CREATE TABLE "StudentFeeAssignment" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "feePlanId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "feePlanFamilyKey" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentFeeAssignment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Fee" ADD COLUMN "studentFeeAssignmentId" TEXT;
ALTER TABLE "Fee" ADD COLUMN "feePlanComponentId" TEXT;
ALTER TABLE "Fee" ADD CONSTRAINT "Fee_generated_source_pair_check"
CHECK (("studentFeeAssignmentId" IS NULL AND "feePlanComponentId" IS NULL) OR ("studentFeeAssignmentId" IS NOT NULL AND "feePlanComponentId" IS NOT NULL));

CREATE UNIQUE INDEX "FeePlanComponent_organizationId_id_key" ON "FeePlanComponent"("organizationId", "id");
CREATE UNIQUE INDEX "FeePlan_assignment_snapshot_key" ON "FeePlan"("organizationId", "id", "familyKey", "academicSessionId");
CREATE UNIQUE INDEX "StudentFeeAssignment_organizationId_id_key" ON "StudentFeeAssignment"("organizationId", "id");
CREATE UNIQUE INDEX "StudentFeeAssignment_student_session_family_key" ON "StudentFeeAssignment"("organizationId", "studentId", "academicSessionId", "feePlanFamilyKey");
CREATE UNIQUE INDEX "StudentFeeAssignment_student_plan_key" ON "StudentFeeAssignment"("organizationId", "studentId", "feePlanId");
CREATE INDEX "StudentFeeAssignment_branch_assignedAt_idx" ON "StudentFeeAssignment"("organizationId", "branchId", "assignedAt");
CREATE INDEX "StudentFeeAssignment_session_student_idx" ON "StudentFeeAssignment"("organizationId", "academicSessionId", "studentId");
CREATE INDEX "StudentFeeAssignment_feePlan_idx" ON "StudentFeeAssignment"("organizationId", "feePlanId");
CREATE UNIQUE INDEX "Fee_assignment_component_key" ON "Fee"("organizationId", "studentFeeAssignmentId", "feePlanComponentId")
WHERE "studentFeeAssignmentId" IS NOT NULL AND "feePlanComponentId" IS NOT NULL;

ALTER TABLE "StudentFeeAssignment" ADD CONSTRAINT "StudentFeeAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentFeeAssignment" ADD CONSTRAINT "StudentFeeAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentFeeAssignment" ADD CONSTRAINT "StudentFeeAssignment_feePlan_snapshot_fkey" FOREIGN KEY ("organizationId", "feePlanId", "feePlanFamilyKey", "academicSessionId") REFERENCES "FeePlan"("organizationId", "id", "familyKey", "academicSessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentFeeAssignment" ADD CONSTRAINT "StudentFeeAssignment_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentFeeAssignment" ADD CONSTRAINT "StudentFeeAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentFeeAssignment" ADD CONSTRAINT "StudentFeeAssignment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentFeeAssignment" ADD CONSTRAINT "StudentFeeAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Fee" ADD CONSTRAINT "Fee_organizationId_studentFeeAssignmentId_fkey" FOREIGN KEY ("organizationId", "studentFeeAssignmentId") REFERENCES "StudentFeeAssignment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Fee" ADD CONSTRAINT "Fee_organizationId_feePlanComponentId_fkey" FOREIGN KEY ("organizationId", "feePlanComponentId") REFERENCES "FeePlanComponent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "Fee_generated_source_lineage_check_fn"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    assignment_plan_id TEXT;
    component_plan_id TEXT;
BEGIN
    IF NEW."studentFeeAssignmentId" IS NULL OR NEW."feePlanComponentId" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT assignment."feePlanId"
      INTO assignment_plan_id
      FROM "StudentFeeAssignment" AS assignment
     WHERE assignment."organizationId" = NEW."organizationId"
       AND assignment."id" = NEW."studentFeeAssignmentId";

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT installment."planId"
      INTO component_plan_id
      FROM "FeePlanComponent" AS component
      JOIN "FeePlanInstallment" AS installment
        ON installment."organizationId" = component."organizationId"
       AND installment."id" = component."installmentId"
     WHERE component."organizationId" = NEW."organizationId"
       AND component."id" = NEW."feePlanComponentId";

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF assignment_plan_id IS DISTINCT FROM component_plan_id THEN
        RAISE EXCEPTION 'Fee generated sources must belong to the same FeePlan'
            USING ERRCODE = '23514', CONSTRAINT = 'Fee_generated_source_lineage_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "Fee_generated_source_lineage_check"
BEFORE INSERT OR UPDATE OF "organizationId", "studentFeeAssignmentId", "feePlanComponentId"
ON "Fee"
FOR EACH ROW
EXECUTE FUNCTION "Fee_generated_source_lineage_check_fn"();
