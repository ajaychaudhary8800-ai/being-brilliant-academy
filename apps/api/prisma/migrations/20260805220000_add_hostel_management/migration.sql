-- CreateEnum
CREATE TYPE "HostelRoomStatus" AS ENUM ('AVAILABLE', 'FULL', 'MAINTENANCE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HostelBedStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "HostelAllocationStatus" AS ENUM ('WAITING', 'ACTIVE', 'CHECKED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HostelAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE');

-- CreateTable
CREATE TABLE "Hostel" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" "Gender",
    "address" TEXT,
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hostel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelBuilding" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "HostelBuilding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelFloor" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "HostelFloor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelRoomType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capacity" INTEGER NOT NULL,
    "baseFeePaise" INTEGER NOT NULL,

    CONSTRAINT "HostelRoomType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelRoom" (
    "id" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "occupancy" INTEGER NOT NULL DEFAULT 0,
    "status" "HostelRoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HostelRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelBed" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "HostelBedStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "HostelBed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelAllocation" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "bedId" TEXT,
    "status" "HostelAllocationStatus" NOT NULL DEFAULT 'WAITING',
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedOutAt" TIMESTAMP(3),
    "depositPaise" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "HostelAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelOccupancyHistory" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "fromBedId" TEXT,
    "toBedId" TEXT,
    "action" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "HostelOccupancyHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelFeeStructure" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "monthlyFeePaise" INTEGER NOT NULL,
    "messChargePaise" INTEGER NOT NULL,
    "depositPaise" INTEGER NOT NULL,
    "finePerDayPaise" INTEGER NOT NULL,

    CONSTRAINT "HostelFeeStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelFee" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "finePaise" INTEGER NOT NULL DEFAULT 0,
    "paidPaise" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATE NOT NULL,
    "status" "FeeStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "HostelFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelFeePayment" (
    "id" TEXT NOT NULL,
    "feeId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRefund" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HostelFeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelAttendance" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "HostelAttendanceStatus" NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "HostelAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelGatePass" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "outAt" TIMESTAMP(3) NOT NULL,
    "inAt" TIMESTAMP(3),
    "approved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HostelGatePass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelVisitor" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "studentId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relation" TEXT,
    "inAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outAt" TIMESTAMP(3),

    CONSTRAINT "HostelVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelMealPlan" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyChargePaise" INTEGER NOT NULL,
    "menu" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HostelMealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelMessAttendance" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "meal" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL,

    CONSTRAINT "HostelMessAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelAsset" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "roomId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,

    CONSTRAINT "HostelAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelInspection" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "condition" TEXT NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "HostelInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelDamageReport" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostelDamageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelMaintenanceRequest" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "HostelMaintenanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Hostel_branchId_status_idx" ON "Hostel"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Hostel_branchId_code_key" ON "Hostel"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "HostelBuilding_hostelId_code_key" ON "HostelBuilding"("hostelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "HostelFloor_buildingId_number_key" ON "HostelFloor"("buildingId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "HostelRoomType_name_key" ON "HostelRoomType"("name");

-- CreateIndex
CREATE INDEX "HostelRoom_status_idx" ON "HostelRoom"("status");

-- CreateIndex
CREATE UNIQUE INDEX "HostelRoom_floorId_roomNumber_key" ON "HostelRoom"("floorId", "roomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HostelBed_roomId_number_key" ON "HostelBed"("roomId", "number");

-- CreateIndex
CREATE INDEX "HostelAllocation_studentId_status_idx" ON "HostelAllocation"("studentId", "status");

-- CreateIndex
CREATE INDEX "HostelAllocation_hostelId_status_idx" ON "HostelAllocation"("hostelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HostelFeeStructure_hostelId_name_key" ON "HostelFeeStructure"("hostelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "HostelFee_allocationId_structureId_period_key" ON "HostelFee"("allocationId", "structureId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "HostelFeePayment_receiptNumber_key" ON "HostelFeePayment"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HostelAttendance_allocationId_date_key" ON "HostelAttendance"("allocationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HostelMealPlan_hostelId_name_key" ON "HostelMealPlan"("hostelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "HostelMessAttendance_allocationId_date_meal_key" ON "HostelMessAttendance"("allocationId", "date", "meal");

-- CreateIndex
CREATE UNIQUE INDEX "HostelAsset_hostelId_code_key" ON "HostelAsset"("hostelId", "code");

-- AddForeignKey
ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelBuilding" ADD CONSTRAINT "HostelBuilding_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelFloor" ADD CONSTRAINT "HostelFloor_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "HostelBuilding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelRoom" ADD CONSTRAINT "HostelRoom_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "HostelFloor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelRoom" ADD CONSTRAINT "HostelRoom_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "HostelRoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelBed" ADD CONSTRAINT "HostelBed_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "HostelRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelAllocation" ADD CONSTRAINT "HostelAllocation_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelAllocation" ADD CONSTRAINT "HostelAllocation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelAllocation" ADD CONSTRAINT "HostelAllocation_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "HostelBed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelOccupancyHistory" ADD CONSTRAINT "HostelOccupancyHistory_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "HostelAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelFeeStructure" ADD CONSTRAINT "HostelFeeStructure_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelFee" ADD CONSTRAINT "HostelFee_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "HostelAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelFee" ADD CONSTRAINT "HostelFee_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "HostelFeeStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelFeePayment" ADD CONSTRAINT "HostelFeePayment_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "HostelFee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelAttendance" ADD CONSTRAINT "HostelAttendance_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "HostelAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelAttendance" ADD CONSTRAINT "HostelAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelGatePass" ADD CONSTRAINT "HostelGatePass_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelVisitor" ADD CONSTRAINT "HostelVisitor_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelMealPlan" ADD CONSTRAINT "HostelMealPlan_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelMessAttendance" ADD CONSTRAINT "HostelMessAttendance_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "HostelAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelMessAttendance" ADD CONSTRAINT "HostelMessAttendance_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "HostelMealPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelAsset" ADD CONSTRAINT "HostelAsset_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelAsset" ADD CONSTRAINT "HostelAsset_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "HostelRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelInspection" ADD CONSTRAINT "HostelInspection_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "HostelRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelDamageReport" ADD CONSTRAINT "HostelDamageReport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "HostelAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelMaintenanceRequest" ADD CONSTRAINT "HostelMaintenanceRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "HostelRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
