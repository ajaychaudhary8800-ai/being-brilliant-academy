-- Additive fee-plan foundation. Existing Fee and FeePayment records are untouched.
CREATE TYPE "FeePlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

CREATE TABLE "FeePlan" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "familyKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "FeePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "academicSessionId" TEXT NOT NULL,
    "branchId" TEXT,
    "courseId" TEXT,
    "batchId" TEXT,
    "supersedesId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeePlanInstallment" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeePlanInstallment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeePlanComponent" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "feeHead" TEXT NOT NULL,
    "normalizedFeeHead" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeePlanComponent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_version_positive" CHECK ("version" > 0);
ALTER TABLE "FeePlanInstallment" ADD CONSTRAINT "FeePlanInstallment_sequence_positive" CHECK ("sequence" > 0);
ALTER TABLE "FeePlanComponent" ADD CONSTRAINT "FeePlanComponent_amount_positive" CHECK ("amountPaise" > 0);

CREATE UNIQUE INDEX "FeePlan_organizationId_familyKey_version_key" ON "FeePlan"("organizationId", "familyKey", "version");
CREATE UNIQUE INDEX "FeePlan_organizationId_code_version_key" ON "FeePlan"("organizationId", "code", "version");
CREATE UNIQUE INDEX "FeePlan_organizationId_id_key" ON "FeePlan"("organizationId", "id");
CREATE UNIQUE INDEX "FeePlan_one_active_applicability_idx" ON "FeePlan"("organizationId", "academicSessionId", "familyKey", COALESCE("branchId", ''), COALESCE("courseId", ''), COALESCE("batchId", '')) WHERE "status" = 'ACTIVE';
CREATE INDEX "FeePlan_organizationId_academicSessionId_status_idx" ON "FeePlan"("organizationId", "academicSessionId", "status");
CREATE INDEX "FeePlan_organizationId_branchId_status_idx" ON "FeePlan"("organizationId", "branchId", "status");
CREATE INDEX "FeePlan_organizationId_courseId_status_idx" ON "FeePlan"("organizationId", "courseId", "status");
CREATE INDEX "FeePlan_organizationId_batchId_status_idx" ON "FeePlan"("organizationId", "batchId", "status");
CREATE UNIQUE INDEX "FeePlanInstallment_planId_sequence_key" ON "FeePlanInstallment"("planId", "sequence");
CREATE UNIQUE INDEX "FeePlanInstallment_organizationId_id_key" ON "FeePlanInstallment"("organizationId", "id");
CREATE INDEX "FeePlanInstallment_organizationId_planId_idx" ON "FeePlanInstallment"("organizationId", "planId");
CREATE UNIQUE INDEX "FeePlanComponent_installmentId_normalizedFeeHead_key" ON "FeePlanComponent"("installmentId", "normalizedFeeHead");
CREATE INDEX "FeePlanComponent_organizationId_installmentId_idx" ON "FeePlanComponent"("organizationId", "installmentId");

ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_organizationId_supersedesId_fkey" FOREIGN KEY ("organizationId", "supersedesId") REFERENCES "FeePlan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeePlanInstallment" ADD CONSTRAINT "FeePlanInstallment_organizationId_planId_fkey" FOREIGN KEY ("organizationId", "planId") REFERENCES "FeePlan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeePlanComponent" ADD CONSTRAINT "FeePlanComponent_organizationId_installmentId_fkey" FOREIGN KEY ("organizationId", "installmentId") REFERENCES "FeePlanInstallment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
