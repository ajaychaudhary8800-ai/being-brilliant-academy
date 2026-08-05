-- CreateEnum
CREATE TYPE "TransportStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TransportStaffRole" AS ENUM ('DRIVER', 'CONDUCTOR', 'ATTENDANT');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('SCHEDULED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TransportVehicleType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "seatCapacity" INTEGER NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TransportVehicleType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportVehicle" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "model" TEXT,
    "manufacturer" TEXT,
    "manufactureYear" INTEGER,
    "seatCapacity" INTEGER NOT NULL,
    "status" "TransportStatus" NOT NULL DEFAULT 'ACTIVE',
    "gpsDeviceId" TEXT,
    "currentLatitude" DECIMAL(10,7),
    "currentLongitude" DECIMAL(10,7),
    "currentSpeed" DECIMAL(7,2),
    "lastGpsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportVehicleDocument" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" DATE,
    "expiryDate" DATE,
    "name" TEXT,
    "mimeType" TEXT,
    "data" BYTEA,

    CONSTRAINT "TransportVehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportService" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "costPaise" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "nextServiceDate" DATE,
    "nextServiceKm" INTEGER,

    CONSTRAINT "TransportService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportFuelLog" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "litres" DECIMAL(8,2) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "vendor" TEXT,

    CONSTRAINT "TransportFuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportStaff" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" "TransportStaffRole" NOT NULL,
    "licenseNumber" TEXT,
    "licenseExpiry" DATE,
    "emergencyContact" TEXT NOT NULL,
    "address" TEXT,
    "status" "TransportStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportVehicleStaff" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE,

    CONSTRAINT "TransportVehicleStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportStaffAttendance" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),

    CONSTRAINT "TransportStaffAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportStop" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "address" TEXT,

    CONSTRAINT "TransportStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRoute" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "distanceKm" DECIMAL(8,2) NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "monthlyFeePaise" INTEGER NOT NULL,
    "status" "TransportStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "TransportRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "pickupSequence" INTEGER NOT NULL,
    "dropSequence" INTEGER NOT NULL,
    "pickupTime" TEXT,
    "dropTime" TEXT,
    "distanceKm" DECIMAL(8,2) NOT NULL DEFAULT 0,

    CONSTRAINT "TransportRouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentTransportAssignment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "pickupStopId" TEXT NOT NULL,
    "dropStopId" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE,
    "monthlyFeePaise" INTEGER NOT NULL,
    "status" "TransportStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "StudentTransportAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRouteChange" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromRouteId" TEXT,
    "toRouteId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "TransportRouteChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportAttendance" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "pickupStatus" "AttendanceStatus" NOT NULL,
    "dropStatus" "AttendanceStatus" NOT NULL,
    "pickupAt" TIMESTAMP(3),
    "dropAt" TIMESTAMP(3),

    CONSTRAINT "TransportAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportTrip" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "TripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startOdometerKm" INTEGER,
    "endOdometerKm" INTEGER,
    "maxSpeed" DECIMAL(7,2),

    CONSTRAINT "TransportTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportGpsPoint" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "speed" DECIMAL(7,2) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geofenceEvent" TEXT,

    CONSTRAINT "TransportGpsPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportFeeBill" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "finePaise" INTEGER NOT NULL DEFAULT 0,
    "paidPaise" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATE NOT NULL,
    "status" "FeeStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "TransportFeeBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportFeePayment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptNumber" TEXT NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "reference" TEXT,
    "refund" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TransportFeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransportVehicleType_name_key" ON "TransportVehicleType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TransportVehicleType_code_key" ON "TransportVehicleType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TransportVehicle_vehicleNumber_key" ON "TransportVehicle"("vehicleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TransportVehicle_gpsDeviceId_key" ON "TransportVehicle"("gpsDeviceId");

-- CreateIndex
CREATE INDEX "TransportVehicle_branchId_status_idx" ON "TransportVehicle"("branchId", "status");

-- CreateIndex
CREATE INDEX "TransportVehicleDocument_expiryDate_idx" ON "TransportVehicleDocument"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "TransportVehicleDocument_vehicleId_type_number_key" ON "TransportVehicleDocument"("vehicleId", "type", "number");

-- CreateIndex
CREATE INDEX "TransportService_vehicleId_serviceDate_idx" ON "TransportService"("vehicleId", "serviceDate");

-- CreateIndex
CREATE INDEX "TransportFuelLog_vehicleId_date_idx" ON "TransportFuelLog"("vehicleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TransportStaff_employeeCode_key" ON "TransportStaff"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "TransportStaff_phone_key" ON "TransportStaff"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "TransportStaff_licenseNumber_key" ON "TransportStaff"("licenseNumber");

-- CreateIndex
CREATE INDEX "TransportStaff_branchId_role_status_idx" ON "TransportStaff"("branchId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransportVehicleStaff_vehicleId_staffId_startsAt_key" ON "TransportVehicleStaff"("vehicleId", "staffId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransportStaffAttendance_staffId_date_key" ON "TransportStaffAttendance"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TransportStop_branchId_code_key" ON "TransportStop"("branchId", "code");

-- CreateIndex
CREATE INDEX "TransportRoute_branchId_status_idx" ON "TransportRoute"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRoute_branchId_code_key" ON "TransportRoute"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRoute_branchId_name_key" ON "TransportRoute"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRouteStop_routeId_stopId_key" ON "TransportRouteStop"("routeId", "stopId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRouteStop_routeId_pickupSequence_key" ON "TransportRouteStop"("routeId", "pickupSequence");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRouteStop_routeId_dropSequence_key" ON "TransportRouteStop"("routeId", "dropSequence");

-- CreateIndex
CREATE INDEX "StudentTransportAssignment_routeId_status_idx" ON "StudentTransportAssignment"("routeId", "status");

-- CreateIndex
CREATE INDEX "StudentTransportAssignment_vehicleId_status_idx" ON "StudentTransportAssignment"("vehicleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransportAttendance_assignmentId_date_key" ON "TransportAttendance"("assignmentId", "date");

-- CreateIndex
CREATE INDEX "TransportTrip_vehicleId_scheduledAt_idx" ON "TransportTrip"("vehicleId", "scheduledAt");

-- CreateIndex
CREATE INDEX "TransportGpsPoint_tripId_recordedAt_idx" ON "TransportGpsPoint"("tripId", "recordedAt");

-- CreateIndex
CREATE INDEX "TransportFeeBill_status_dueDate_idx" ON "TransportFeeBill"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "TransportFeeBill_assignmentId_year_month_key" ON "TransportFeeBill"("assignmentId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "TransportFeePayment_receiptNumber_key" ON "TransportFeePayment"("receiptNumber");

-- CreateIndex
CREATE INDEX "TransportFeePayment_paidAt_idx" ON "TransportFeePayment"("paidAt");

-- AddForeignKey
ALTER TABLE "TransportVehicle" ADD CONSTRAINT "TransportVehicle_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVehicle" ADD CONSTRAINT "TransportVehicle_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TransportVehicleType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVehicleDocument" ADD CONSTRAINT "TransportVehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "TransportVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportService" ADD CONSTRAINT "TransportService_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "TransportVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportFuelLog" ADD CONSTRAINT "TransportFuelLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "TransportVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportStaff" ADD CONSTRAINT "TransportStaff_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVehicleStaff" ADD CONSTRAINT "TransportVehicleStaff_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "TransportVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVehicleStaff" ADD CONSTRAINT "TransportVehicleStaff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "TransportStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportStaffAttendance" ADD CONSTRAINT "TransportStaffAttendance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "TransportStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportStop" ADD CONSTRAINT "TransportStop_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRoute" ADD CONSTRAINT "TransportRoute_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "TransportVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRouteStop" ADD CONSTRAINT "TransportRouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRouteStop" ADD CONSTRAINT "TransportRouteStop_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "TransportStop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTransportAssignment" ADD CONSTRAINT "StudentTransportAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTransportAssignment" ADD CONSTRAINT "StudentTransportAssignment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTransportAssignment" ADD CONSTRAINT "StudentTransportAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "TransportVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTransportAssignment" ADD CONSTRAINT "StudentTransportAssignment_pickupStopId_fkey" FOREIGN KEY ("pickupStopId") REFERENCES "TransportStop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTransportAssignment" ADD CONSTRAINT "StudentTransportAssignment_dropStopId_fkey" FOREIGN KEY ("dropStopId") REFERENCES "TransportStop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRouteChange" ADD CONSTRAINT "TransportRouteChange_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentTransportAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportAttendance" ADD CONSTRAINT "TransportAttendance_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentTransportAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportAttendance" ADD CONSTRAINT "TransportAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "TransportVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "TransportStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportGpsPoint" ADD CONSTRAINT "TransportGpsPoint_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportFeeBill" ADD CONSTRAINT "TransportFeeBill_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentTransportAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportFeeBill" ADD CONSTRAINT "TransportFeeBill_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportFeePayment" ADD CONSTRAINT "TransportFeePayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "TransportFeeBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
