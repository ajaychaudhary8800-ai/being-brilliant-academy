CREATE TYPE "TeacherAllocationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "TeacherAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "academicSessionId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "weeklyPeriods" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "remarks" TEXT,
    "status" "TeacherAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeacherAllocation_weeklyPeriods_check" CHECK ("weeklyPeriods" BETWEEN 1 AND 100),
    CONSTRAINT "TeacherAllocation_effectiveDates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
    CONSTRAINT "TeacherAllocation_subjectName_check" CHECK (length(btrim("subjectName")) BETWEEN 2 AND 120)
);

CREATE INDEX "TeacherAllocation_organizationId_status_idx" ON "TeacherAllocation"("organizationId", "status");
CREATE INDEX "TeacherAllocation_organizationId_academicSessionId_idx" ON "TeacherAllocation"("organizationId", "academicSessionId");
CREATE INDEX "TeacherAllocation_organizationId_branchId_idx" ON "TeacherAllocation"("organizationId", "branchId");
CREATE INDEX "TeacherAllocation_organizationId_courseId_idx" ON "TeacherAllocation"("organizationId", "courseId");
CREATE INDEX "TeacherAllocation_organizationId_batchId_idx" ON "TeacherAllocation"("organizationId", "batchId");
CREATE INDEX "TeacherAllocation_organizationId_teacherId_idx" ON "TeacherAllocation"("organizationId", "teacherId");
CREATE INDEX "TeacherAllocation_organizationId_subjectName_idx" ON "TeacherAllocation"("organizationId", "subjectName");

-- Historical inactive allocations may coexist. Only one active allocation is
-- allowed for the same teacher, subject, batch and academic session.
CREATE UNIQUE INDEX "TeacherAllocation_active_assignment_key"
ON "TeacherAllocation"("organizationId", "teacherId", "batchId", "academicSessionId", lower(btrim("subjectName")))
WHERE "status" = 'ACTIVE';

ALTER TABLE "TeacherAllocation" ADD CONSTRAINT "TeacherAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherAllocation" ADD CONSTRAINT "TeacherAllocation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherAllocation" ADD CONSTRAINT "TeacherAllocation_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "AcademicSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherAllocation" ADD CONSTRAINT "TeacherAllocation_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherAllocation" ADD CONSTRAINT "TeacherAllocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherAllocation" ADD CONSTRAINT "TeacherAllocation_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherAllocation" ADD CONSTRAINT "TeacherAllocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherAllocation" ADD CONSTRAINT "TeacherAllocation_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
