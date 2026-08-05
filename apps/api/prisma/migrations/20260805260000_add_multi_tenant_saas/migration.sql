-- CreateEnum
CREATE TYPE "OrganizationSubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- AlterTable
ALTER TABLE "AccountGroup" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AnalyticsAlert" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AnalyticsAssistantQuery" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AnalyticsForecast" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AnalyticsReportSchedule" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AnalyticsSavedReport" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AnalyticsSnapshot" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AnnouncementRead" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AnnualMaintenanceContract" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AssetCategory" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AssetDisposal" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AssetMaintenanceTicket" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AssetTransfer" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AssetWarranty" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AssignmentSubmission" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "BranchUser" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "CalendarEventRsvp" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Circular" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "CircularAcknowledgement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "CircularDownload" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "CircularVersion" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Classroom" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "CourseSubject" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Designation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "EmployeeDocument" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "EmployeeExperience" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "EmployeeLeave" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "EmployeeLeaveBalance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "EmployeeLoan" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "EmployeeMovement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "EnquiryFollowUp" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "EnterpriseAsset" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "ExamAttempt" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Examination" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "ExaminationResult" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "ExpenseBill" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Fee" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "FeeAdjustment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "FeePayment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "FinanceBankAccount" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "FinanceBankTransaction" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "FinanceVendor" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "FinancialYear" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "GstConfiguration" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HomeworkSubmission" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Hostel" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelAllocation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelAsset" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelAttendance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelBed" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelBuilding" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelDamageReport" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelFee" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelFeePayment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelFeeStructure" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelFloor" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelGatePass" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelInspection" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelMaintenanceRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelMealPlan" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelMessAttendance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelOccupancyHistory" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelRoom" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelRoomType" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HostelVisitor" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HrAttendance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "HrHoliday" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryGoodsReceipt" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryGoodsReceiptLine" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryItemCategory" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryLocation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryPurchaseOrder" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryPurchaseOrderLine" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryPurchaseRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryPurchaseRequestLine" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryStockLot" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryStockMovement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryStore" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "InventoryVendor" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LedgerAccount" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LessonAttachment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LessonProgress" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryAuthor" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryBook" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryBookAuthor" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryBookCopy" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryCategory" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryDigitalResource" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryDisposal" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryFinePayment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryLoan" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryMember" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryPublisher" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryPurchase" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryReservation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryShelf" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryStockVerification" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryStockVerificationItem" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "LibraryVendor" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "MaintenanceWorkOrder" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "MessageThreadMember" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "NotificationDelivery" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Overtime" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "ParentStudent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "PayrollComponent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "PerformanceReview" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "PortalMessage" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "PreventiveMaintenanceSchedule" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "RecruitmentCandidate" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Reimbursement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "SalaryStructure" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "StudentAnalyticsProfile" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "StudentTransportAssignment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TaxDocument" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TeacherAnalyticsProfile" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TeacherAttendance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TeacherProfile" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TestAttempt" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TestBatch" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "Timetable" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportAttendance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportFeeBill" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportFeePayment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportFuelLog" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportGpsPoint" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportRoute" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportRouteChange" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportRouteStop" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportService" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportStaff" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportStaffAttendance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportStop" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportTrip" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportVehicle" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportVehicleDocument" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportVehicleStaff" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "TransportVehicleType" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT 'org_default';

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1d4ed8',
    "secondaryColor" TEXT NOT NULL DEFAULT '#0f172a',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Calcutta',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "academicYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "settings" JSONB,
    "subscriptionStatus" "OrganizationSubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "subscriptionPlan" TEXT NOT NULL DEFAULT 'ENTERPRISE',
    "trialEndsAt" TIMESTAMP(3),
    "subscriptionEndsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- Preserve all pre-SaaS records inside the default organization before tenant foreign keys are applied.
INSERT INTO "Organization" ("id", "slug", "name", "legalName", "email", "subscriptionStatus", "subscriptionPlan", "isActive", "updatedAt")
VALUES ('org_default', 'being-brilliant-academy', 'Being Brilliant Academy', 'Being Brilliant Academy', 'admin@beingbrilliant.in', 'ACTIVE', 'ENTERPRISE', true, CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "TenantAccessAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "allowed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantAccessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_subscriptionStatus_isActive_idx" ON "Organization"("subscriptionStatus", "isActive");

-- CreateIndex
CREATE INDEX "TenantAccessAudit_organizationId_createdAt_idx" ON "TenantAccessAudit"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "TenantAccessAudit_userId_createdAt_idx" ON "TenantAccessAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountGroup_organizationId_idx" ON "AccountGroup"("organizationId");

-- CreateIndex
CREATE INDEX "AnalyticsAlert_organizationId_idx" ON "AnalyticsAlert"("organizationId");

-- CreateIndex
CREATE INDEX "AnalyticsAssistantQuery_organizationId_idx" ON "AnalyticsAssistantQuery"("organizationId");

-- CreateIndex
CREATE INDEX "AnalyticsForecast_organizationId_idx" ON "AnalyticsForecast"("organizationId");

-- CreateIndex
CREATE INDEX "AnalyticsReportSchedule_organizationId_idx" ON "AnalyticsReportSchedule"("organizationId");

-- CreateIndex
CREATE INDEX "AnalyticsSavedReport_organizationId_idx" ON "AnalyticsSavedReport"("organizationId");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_organizationId_idx" ON "AnalyticsSnapshot"("organizationId");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_idx" ON "Announcement"("organizationId");

-- CreateIndex
CREATE INDEX "AnnouncementRead_organizationId_idx" ON "AnnouncementRead"("organizationId");

-- CreateIndex
CREATE INDEX "AnnualMaintenanceContract_organizationId_idx" ON "AnnualMaintenanceContract"("organizationId");

-- CreateIndex
CREATE INDEX "AssetCategory_organizationId_idx" ON "AssetCategory"("organizationId");

-- CreateIndex
CREATE INDEX "AssetDisposal_organizationId_idx" ON "AssetDisposal"("organizationId");

-- CreateIndex
CREATE INDEX "AssetMaintenanceTicket_organizationId_idx" ON "AssetMaintenanceTicket"("organizationId");

-- CreateIndex
CREATE INDEX "AssetTransfer_organizationId_idx" ON "AssetTransfer"("organizationId");

-- CreateIndex
CREATE INDEX "AssetWarranty_organizationId_idx" ON "AssetWarranty"("organizationId");

-- CreateIndex
CREATE INDEX "Assignment_organizationId_idx" ON "Assignment"("organizationId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_organizationId_idx" ON "AssignmentSubmission"("organizationId");

-- CreateIndex
CREATE INDEX "Attendance_organizationId_idx" ON "Attendance"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "Batch_organizationId_idx" ON "Batch"("organizationId");

-- CreateIndex
CREATE INDEX "Branch_organizationId_idx" ON "Branch"("organizationId");

-- CreateIndex
CREATE INDEX "BranchUser_organizationId_idx" ON "BranchUser"("organizationId");

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_idx" ON "CalendarEvent"("organizationId");

-- CreateIndex
CREATE INDEX "CalendarEventRsvp_organizationId_idx" ON "CalendarEventRsvp"("organizationId");

-- CreateIndex
CREATE INDEX "Category_organizationId_idx" ON "Category"("organizationId");

-- CreateIndex
CREATE INDEX "Certificate_organizationId_idx" ON "Certificate"("organizationId");

-- CreateIndex
CREATE INDEX "Circular_organizationId_idx" ON "Circular"("organizationId");

-- CreateIndex
CREATE INDEX "CircularAcknowledgement_organizationId_idx" ON "CircularAcknowledgement"("organizationId");

-- CreateIndex
CREATE INDEX "CircularDownload_organizationId_idx" ON "CircularDownload"("organizationId");

-- CreateIndex
CREATE INDEX "CircularVersion_organizationId_idx" ON "CircularVersion"("organizationId");

-- CreateIndex
CREATE INDEX "Classroom_organizationId_idx" ON "Classroom"("organizationId");

-- CreateIndex
CREATE INDEX "Coupon_organizationId_idx" ON "Coupon"("organizationId");

-- CreateIndex
CREATE INDEX "Course_organizationId_idx" ON "Course"("organizationId");

-- CreateIndex
CREATE INDEX "CourseSubject_organizationId_idx" ON "CourseSubject"("organizationId");

-- CreateIndex
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

-- CreateIndex
CREATE INDEX "Designation_organizationId_idx" ON "Designation"("organizationId");

-- CreateIndex
CREATE INDEX "Employee_organizationId_idx" ON "Employee"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_organizationId_idx" ON "EmployeeDocument"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeExperience_organizationId_idx" ON "EmployeeExperience"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeLeave_organizationId_idx" ON "EmployeeLeave"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeLeaveBalance_organizationId_idx" ON "EmployeeLeaveBalance"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeLoan_organizationId_idx" ON "EmployeeLoan"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeMovement_organizationId_idx" ON "EmployeeMovement"("organizationId");

-- CreateIndex
CREATE INDEX "Enquiry_organizationId_idx" ON "Enquiry"("organizationId");

-- CreateIndex
CREATE INDEX "EnquiryFollowUp_organizationId_idx" ON "EnquiryFollowUp"("organizationId");

-- CreateIndex
CREATE INDEX "Enrollment_organizationId_idx" ON "Enrollment"("organizationId");

-- CreateIndex
CREATE INDEX "EnterpriseAsset_organizationId_idx" ON "EnterpriseAsset"("organizationId");

-- CreateIndex
CREATE INDEX "Exam_organizationId_idx" ON "Exam"("organizationId");

-- CreateIndex
CREATE INDEX "ExamAttempt_organizationId_idx" ON "ExamAttempt"("organizationId");

-- CreateIndex
CREATE INDEX "Examination_organizationId_idx" ON "Examination"("organizationId");

-- CreateIndex
CREATE INDEX "ExaminationResult_organizationId_idx" ON "ExaminationResult"("organizationId");

-- CreateIndex
CREATE INDEX "ExpenseBill_organizationId_idx" ON "ExpenseBill"("organizationId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_organizationId_idx" ON "ExpenseCategory"("organizationId");

-- CreateIndex
CREATE INDEX "Fee_organizationId_idx" ON "Fee"("organizationId");

-- CreateIndex
CREATE INDEX "FeeAdjustment_organizationId_idx" ON "FeeAdjustment"("organizationId");

-- CreateIndex
CREATE INDEX "FeePayment_organizationId_idx" ON "FeePayment"("organizationId");

-- CreateIndex
CREATE INDEX "FinanceBankAccount_organizationId_idx" ON "FinanceBankAccount"("organizationId");

-- CreateIndex
CREATE INDEX "FinanceBankTransaction_organizationId_idx" ON "FinanceBankTransaction"("organizationId");

-- CreateIndex
CREATE INDEX "FinanceVendor_organizationId_idx" ON "FinanceVendor"("organizationId");

-- CreateIndex
CREATE INDEX "FinancialYear_organizationId_idx" ON "FinancialYear"("organizationId");

-- CreateIndex
CREATE INDEX "GstConfiguration_organizationId_idx" ON "GstConfiguration"("organizationId");

-- CreateIndex
CREATE INDEX "Holiday_organizationId_idx" ON "Holiday"("organizationId");

-- CreateIndex
CREATE INDEX "Homework_organizationId_idx" ON "Homework"("organizationId");

-- CreateIndex
CREATE INDEX "HomeworkSubmission_organizationId_idx" ON "HomeworkSubmission"("organizationId");

-- CreateIndex
CREATE INDEX "Hostel_organizationId_idx" ON "Hostel"("organizationId");

-- CreateIndex
CREATE INDEX "HostelAllocation_organizationId_idx" ON "HostelAllocation"("organizationId");

-- CreateIndex
CREATE INDEX "HostelAsset_organizationId_idx" ON "HostelAsset"("organizationId");

-- CreateIndex
CREATE INDEX "HostelAttendance_organizationId_idx" ON "HostelAttendance"("organizationId");

-- CreateIndex
CREATE INDEX "HostelBed_organizationId_idx" ON "HostelBed"("organizationId");

-- CreateIndex
CREATE INDEX "HostelBuilding_organizationId_idx" ON "HostelBuilding"("organizationId");

-- CreateIndex
CREATE INDEX "HostelDamageReport_organizationId_idx" ON "HostelDamageReport"("organizationId");

-- CreateIndex
CREATE INDEX "HostelFee_organizationId_idx" ON "HostelFee"("organizationId");

-- CreateIndex
CREATE INDEX "HostelFeePayment_organizationId_idx" ON "HostelFeePayment"("organizationId");

-- CreateIndex
CREATE INDEX "HostelFeeStructure_organizationId_idx" ON "HostelFeeStructure"("organizationId");

-- CreateIndex
CREATE INDEX "HostelFloor_organizationId_idx" ON "HostelFloor"("organizationId");

-- CreateIndex
CREATE INDEX "HostelGatePass_organizationId_idx" ON "HostelGatePass"("organizationId");

-- CreateIndex
CREATE INDEX "HostelInspection_organizationId_idx" ON "HostelInspection"("organizationId");

-- CreateIndex
CREATE INDEX "HostelMaintenanceRequest_organizationId_idx" ON "HostelMaintenanceRequest"("organizationId");

-- CreateIndex
CREATE INDEX "HostelMealPlan_organizationId_idx" ON "HostelMealPlan"("organizationId");

-- CreateIndex
CREATE INDEX "HostelMessAttendance_organizationId_idx" ON "HostelMessAttendance"("organizationId");

-- CreateIndex
CREATE INDEX "HostelOccupancyHistory_organizationId_idx" ON "HostelOccupancyHistory"("organizationId");

-- CreateIndex
CREATE INDEX "HostelRoom_organizationId_idx" ON "HostelRoom"("organizationId");

-- CreateIndex
CREATE INDEX "HostelRoomType_organizationId_idx" ON "HostelRoomType"("organizationId");

-- CreateIndex
CREATE INDEX "HostelVisitor_organizationId_idx" ON "HostelVisitor"("organizationId");

-- CreateIndex
CREATE INDEX "HrAttendance_organizationId_idx" ON "HrAttendance"("organizationId");

-- CreateIndex
CREATE INDEX "HrHoliday_organizationId_idx" ON "HrHoliday"("organizationId");

-- CreateIndex
CREATE INDEX "Interview_organizationId_idx" ON "Interview"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryGoodsReceipt_organizationId_idx" ON "InventoryGoodsReceipt"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryGoodsReceiptLine_organizationId_idx" ON "InventoryGoodsReceiptLine"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryItem_organizationId_idx" ON "InventoryItem"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryItemCategory_organizationId_idx" ON "InventoryItemCategory"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryLocation_organizationId_idx" ON "InventoryLocation"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryPurchaseOrder_organizationId_idx" ON "InventoryPurchaseOrder"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryPurchaseOrderLine_organizationId_idx" ON "InventoryPurchaseOrderLine"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryPurchaseRequest_organizationId_idx" ON "InventoryPurchaseRequest"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryPurchaseRequestLine_organizationId_idx" ON "InventoryPurchaseRequestLine"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryStockLot_organizationId_idx" ON "InventoryStockLot"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryStockMovement_organizationId_idx" ON "InventoryStockMovement"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryStore_organizationId_idx" ON "InventoryStore"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryVendor_organizationId_idx" ON "InventoryVendor"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_idx" ON "JournalEntry"("organizationId");

-- CreateIndex
CREATE INDEX "JournalLine_organizationId_idx" ON "JournalLine"("organizationId");

-- CreateIndex
CREATE INDEX "LeaveRequest_organizationId_idx" ON "LeaveRequest"("organizationId");

-- CreateIndex
CREATE INDEX "LedgerAccount_organizationId_idx" ON "LedgerAccount"("organizationId");

-- CreateIndex
CREATE INDEX "Lesson_organizationId_idx" ON "Lesson"("organizationId");

-- CreateIndex
CREATE INDEX "LessonAttachment_organizationId_idx" ON "LessonAttachment"("organizationId");

-- CreateIndex
CREATE INDEX "LessonProgress_organizationId_idx" ON "LessonProgress"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryAuthor_organizationId_idx" ON "LibraryAuthor"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryBook_organizationId_idx" ON "LibraryBook"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryBookAuthor_organizationId_idx" ON "LibraryBookAuthor"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryBookCopy_organizationId_idx" ON "LibraryBookCopy"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryCategory_organizationId_idx" ON "LibraryCategory"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryDigitalResource_organizationId_idx" ON "LibraryDigitalResource"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryDisposal_organizationId_idx" ON "LibraryDisposal"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryFinePayment_organizationId_idx" ON "LibraryFinePayment"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryLoan_organizationId_idx" ON "LibraryLoan"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryMember_organizationId_idx" ON "LibraryMember"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryPublisher_organizationId_idx" ON "LibraryPublisher"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryPurchase_organizationId_idx" ON "LibraryPurchase"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryReservation_organizationId_idx" ON "LibraryReservation"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryShelf_organizationId_idx" ON "LibraryShelf"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryStockVerification_organizationId_idx" ON "LibraryStockVerification"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryStockVerificationItem_organizationId_idx" ON "LibraryStockVerificationItem"("organizationId");

-- CreateIndex
CREATE INDEX "LibraryVendor_organizationId_idx" ON "LibraryVendor"("organizationId");

-- CreateIndex
CREATE INDEX "MaintenanceWorkOrder_organizationId_idx" ON "MaintenanceWorkOrder"("organizationId");

-- CreateIndex
CREATE INDEX "MessageThread_organizationId_idx" ON "MessageThread"("organizationId");

-- CreateIndex
CREATE INDEX "MessageThreadMember_organizationId_idx" ON "MessageThreadMember"("organizationId");

-- CreateIndex
CREATE INDEX "Module_organizationId_idx" ON "Module"("organizationId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_organizationId_idx" ON "NotificationDelivery"("organizationId");

-- CreateIndex
CREATE INDEX "NotificationPreference_organizationId_idx" ON "NotificationPreference"("organizationId");

-- CreateIndex
CREATE INDEX "Overtime_organizationId_idx" ON "Overtime"("organizationId");

-- CreateIndex
CREATE INDEX "ParentStudent_organizationId_idx" ON "ParentStudent"("organizationId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_organizationId_idx" ON "PasswordResetToken"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "PayrollComponent_organizationId_idx" ON "PayrollComponent"("organizationId");

-- CreateIndex
CREATE INDEX "PayrollRun_organizationId_idx" ON "PayrollRun"("organizationId");

-- CreateIndex
CREATE INDEX "Payslip_organizationId_idx" ON "Payslip"("organizationId");

-- CreateIndex
CREATE INDEX "PerformanceReview_organizationId_idx" ON "PerformanceReview"("organizationId");

-- CreateIndex
CREATE INDEX "PortalMessage_organizationId_idx" ON "PortalMessage"("organizationId");

-- CreateIndex
CREATE INDEX "PreventiveMaintenanceSchedule_organizationId_idx" ON "PreventiveMaintenanceSchedule"("organizationId");

-- CreateIndex
CREATE INDEX "Question_organizationId_idx" ON "Question"("organizationId");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_organizationId_idx" ON "RecruitmentCandidate"("organizationId");

-- CreateIndex
CREATE INDEX "Reimbursement_organizationId_idx" ON "Reimbursement"("organizationId");

-- CreateIndex
CREATE INDEX "SalaryStructure_organizationId_idx" ON "SalaryStructure"("organizationId");

-- CreateIndex
CREATE INDEX "Session_organizationId_idx" ON "Session"("organizationId");

-- CreateIndex
CREATE INDEX "Shift_organizationId_idx" ON "Shift"("organizationId");

-- CreateIndex
CREATE INDEX "StudentAnalyticsProfile_organizationId_idx" ON "StudentAnalyticsProfile"("organizationId");

-- CreateIndex
CREATE INDEX "StudentProfile_organizationId_idx" ON "StudentProfile"("organizationId");

-- CreateIndex
CREATE INDEX "StudentTransportAssignment_organizationId_idx" ON "StudentTransportAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "Subject_organizationId_idx" ON "Subject"("organizationId");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_idx" ON "SupportTicket"("organizationId");

-- CreateIndex
CREATE INDEX "TaxDocument_organizationId_idx" ON "TaxDocument"("organizationId");

-- CreateIndex
CREATE INDEX "TeacherAnalyticsProfile_organizationId_idx" ON "TeacherAnalyticsProfile"("organizationId");

-- CreateIndex
CREATE INDEX "TeacherAttendance_organizationId_idx" ON "TeacherAttendance"("organizationId");

-- CreateIndex
CREATE INDEX "TeacherProfile_organizationId_idx" ON "TeacherProfile"("organizationId");

-- CreateIndex
CREATE INDEX "Test_organizationId_idx" ON "Test"("organizationId");

-- CreateIndex
CREATE INDEX "TestAttempt_organizationId_idx" ON "TestAttempt"("organizationId");

-- CreateIndex
CREATE INDEX "TestBatch_organizationId_idx" ON "TestBatch"("organizationId");

-- CreateIndex
CREATE INDEX "Timetable_organizationId_idx" ON "Timetable"("organizationId");

-- CreateIndex
CREATE INDEX "TransportAttendance_organizationId_idx" ON "TransportAttendance"("organizationId");

-- CreateIndex
CREATE INDEX "TransportFeeBill_organizationId_idx" ON "TransportFeeBill"("organizationId");

-- CreateIndex
CREATE INDEX "TransportFeePayment_organizationId_idx" ON "TransportFeePayment"("organizationId");

-- CreateIndex
CREATE INDEX "TransportFuelLog_organizationId_idx" ON "TransportFuelLog"("organizationId");

-- CreateIndex
CREATE INDEX "TransportGpsPoint_organizationId_idx" ON "TransportGpsPoint"("organizationId");

-- CreateIndex
CREATE INDEX "TransportRoute_organizationId_idx" ON "TransportRoute"("organizationId");

-- CreateIndex
CREATE INDEX "TransportRouteChange_organizationId_idx" ON "TransportRouteChange"("organizationId");

-- CreateIndex
CREATE INDEX "TransportRouteStop_organizationId_idx" ON "TransportRouteStop"("organizationId");

-- CreateIndex
CREATE INDEX "TransportService_organizationId_idx" ON "TransportService"("organizationId");

-- CreateIndex
CREATE INDEX "TransportStaff_organizationId_idx" ON "TransportStaff"("organizationId");

-- CreateIndex
CREATE INDEX "TransportStaffAttendance_organizationId_idx" ON "TransportStaffAttendance"("organizationId");

-- CreateIndex
CREATE INDEX "TransportStop_organizationId_idx" ON "TransportStop"("organizationId");

-- CreateIndex
CREATE INDEX "TransportTrip_organizationId_idx" ON "TransportTrip"("organizationId");

-- CreateIndex
CREATE INDEX "TransportVehicle_organizationId_idx" ON "TransportVehicle"("organizationId");

-- CreateIndex
CREATE INDEX "TransportVehicleDocument_organizationId_idx" ON "TransportVehicleDocument"("organizationId");

-- CreateIndex
CREATE INDEX "TransportVehicleStaff_organizationId_idx" ON "TransportVehicleStaff"("organizationId");

-- CreateIndex
CREATE INDEX "TransportVehicleType_organizationId_idx" ON "TransportVehicleType"("organizationId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- AddForeignKey
ALTER TABLE "TenantAccessAudit" ADD CONSTRAINT "TenantAccessAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
