-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'NOTICE', 'EXITED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HrLeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'CALCULATED', 'LOCKED', 'PAID');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('JOINING', 'PROMOTION', 'TRANSFER', 'EXIT', 'INCREMENT');

-- CreateEnum
CREATE TYPE "ComponentType" AS ENUM ('EARNING', 'DEDUCTION', 'PF', 'ESI', 'PROFESSIONAL_TAX', 'TDS', 'BONUS', 'INCENTIVE', 'REIMBURSEMENT', 'LOAN');

-- AlterEnum
BEGIN;
CREATE TYPE "CourseType_new" AS ENUM ('SCHOOL', 'JEE', 'NEET', 'CUET', 'NDA', 'CA_FOUNDATION', 'SKILL', 'OTHER');
ALTER TABLE "public"."Course" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Course" ALTER COLUMN "type" TYPE "CourseType_new" USING ("type"::text::"CourseType_new");
ALTER TYPE "CourseType" RENAME TO "CourseType_old";
ALTER TYPE "CourseType_new" RENAME TO "CourseType";
DROP TYPE "public"."CourseType_old";
ALTER TABLE "Course" ALTER COLUMN "type" SET DEFAULT 'OTHER';
COMMIT;

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'EMPLOYEE';

-- DropForeignKey
ALTER TABLE "StudentProfile" DROP CONSTRAINT "StudentProfile_batchId_fkey";

-- AlterTable
ALTER TABLE "Attendance" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Batch" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Branch" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Certificate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Classroom" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Course" DROP COLUMN "level",
DROP COLUMN "published",
DROP COLUMN "trailerUrl",
ALTER COLUMN "type" SET DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "Enquiry" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Examination" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExaminationResult" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Fee" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Homework" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "HomeworkSubmission" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LeaveRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TeacherAttendance" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Test" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TestAttempt" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Timetable" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Designation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "designationId" TEXT NOT NULL,
    "joiningDate" DATE NOT NULL,
    "employmentType" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "bankName" TEXT,
    "bankAccount" TEXT,
    "ifsc" TEXT,
    "pan" TEXT,
    "uan" TEXT,
    "esiNumber" TEXT,
    "biometricCode" TEXT,
    "emergencyContact" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "exitDate" DATE,
    "exitReason" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentCandidate" (
    "id" TEXT NOT NULL,
    "candidateCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "source" TEXT,
    "resumeName" TEXT,
    "resumeMime" TEXT,
    "resumeData" BYTEA,
    "status" "CandidateStatus" NOT NULL DEFAULT 'APPLIED',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "interviewer" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "score" INTEGER,
    "outcome" TEXT,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "expiresAt" DATE,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeExperience" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE,
    "remarks" TEXT,

    CONSTRAINT "EmployeeExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeMovement" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "weeklyOff" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "biometricReference" TEXT,
    "remarks" TEXT,

    CONSTRAINT "HrAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLeaveBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "leaveType" TEXT NOT NULL,
    "opening" DECIMAL(6,2) NOT NULL,
    "accrued" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "used" DECIMAL(6,2) NOT NULL DEFAULT 0,

    CONSTRAINT "EmployeeLeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLeave" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "HrLeaveStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrHoliday" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HrHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Overtime" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Overtime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReview" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "rating" DECIMAL(3,2) NOT NULL,
    "goals" TEXT,
    "feedback" TEXT,
    "appraisalPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "basicPaise" INTEGER NOT NULL,
    "hraPaise" INTEGER NOT NULL DEFAULT 0,
    "allowancePaise" INTEGER NOT NULL DEFAULT 0,
    "pfPercent" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "esiPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "professionalTaxPaise" INTEGER NOT NULL DEFAULT 0,
    "tdsPaise" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "lockedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workingDays" DECIMAL(6,2) NOT NULL,
    "paidDays" DECIMAL(6,2) NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "deductionPaise" INTEGER NOT NULL,
    "netPaise" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollComponent" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "type" "ComponentType" NOT NULL,
    "name" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,

    CONSTRAINT "PayrollComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLoan" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "principalPaise" INTEGER NOT NULL,
    "installmentPaise" INTEGER NOT NULL,
    "balancePaise" INTEGER NOT NULL,
    "startsAt" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reimbursement" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "expenseDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reimbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_code_key" ON "Designation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_departmentId_name_key" ON "Designation"("departmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_pan_key" ON "Employee"("pan");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_biometricCode_key" ON "Employee"("biometricCode");

-- CreateIndex
CREATE INDEX "Employee_branchId_status_idx" ON "Employee"("branchId", "status");

-- CreateIndex
CREATE INDEX "Employee_departmentId_designationId_idx" ON "Employee"("departmentId", "designationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentCandidate_candidateCode_key" ON "RecruitmentCandidate"("candidateCode");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_branchId_status_idx" ON "RecruitmentCandidate"("branchId", "status");

-- CreateIndex
CREATE INDEX "Interview_candidateId_scheduledAt_idx" ON "Interview"("candidateId", "scheduledAt");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_type_idx" ON "EmployeeDocument"("employeeId", "type");

-- CreateIndex
CREATE INDEX "EmployeeMovement_employeeId_type_effectiveDate_idx" ON "EmployeeMovement"("employeeId", "type", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_code_key" ON "Shift"("code");

-- CreateIndex
CREATE INDEX "HrAttendance_date_status_idx" ON "HrAttendance"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HrAttendance_employeeId_date_key" ON "HrAttendance"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLeaveBalance_employeeId_year_leaveType_key" ON "EmployeeLeaveBalance"("employeeId", "year", "leaveType");

-- CreateIndex
CREATE INDEX "EmployeeLeave_status_fromDate_idx" ON "EmployeeLeave"("status", "fromDate");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLeave_employeeId_fromDate_toDate_leaveType_key" ON "EmployeeLeave"("employeeId", "fromDate", "toDate", "leaveType");

-- CreateIndex
CREATE UNIQUE INDEX "HrHoliday_branchId_date_key" ON "HrHoliday"("branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Overtime_employeeId_date_key" ON "Overtime"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceReview_employeeId_period_key" ON "PerformanceReview"("employeeId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructure_employeeId_effectiveFrom_key" ON "SalaryStructure"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_branchId_year_month_key" ON "PayrollRun"("branchId", "year", "month");

-- CreateIndex
CREATE INDEX "Payslip_employeeId_generatedAt_idx" ON "Payslip"("employeeId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_payrollRunId_employeeId_key" ON "Payslip"("payrollRunId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollComponent_payslipId_type_idx" ON "PayrollComponent"("payslipId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDocument_employeeId_year_type_key" ON "TaxDocument"("employeeId", "year", "type");

-- CreateIndex
CREATE INDEX "Course_title_idx" ON "Course"("title");

-- CreateIndex
CREATE INDEX "Course_courseCode_idx" ON "Course"("courseCode");

-- CreateIndex
CREATE INDEX "Course_type_idx" ON "Course"("type");

-- CreateIndex
CREATE INDEX "Course_categoryId_idx" ON "Course"("categoryId");

-- CreateIndex
CREATE INDEX "CourseSubject_teacherId_idx" ON "CourseSubject"("teacherId");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSubject" ADD CONSTRAINT "CourseSubject_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSubject" ADD CONSTRAINT "CourseSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSubject" ADD CONSTRAINT "CourseSubject_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Designation" ADD CONSTRAINT "Designation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeExperience" ADD CONSTRAINT "EmployeeExperience_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeMovement" ADD CONSTRAINT "EmployeeMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendance" ADD CONSTRAINT "HrAttendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendance" ADD CONSTRAINT "HrAttendance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeaveBalance" ADD CONSTRAINT "EmployeeLeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeave" ADD CONSTRAINT "EmployeeLeave_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeave" ADD CONSTRAINT "EmployeeLeave_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrHoliday" ADD CONSTRAINT "HrHoliday_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Overtime" ADD CONSTRAINT "Overtime_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollComponent" ADD CONSTRAINT "PayrollComponent_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLoan" ADD CONSTRAINT "EmployeeLoan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
