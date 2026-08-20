ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'FULL_DAY_LEAVE';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'HALF_DAY_LEAVE';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'SHORT_LEAVE';

CREATE TYPE "LeaveType" AS ENUM ('FULL_DAY', 'HALF_DAY', 'SHORT_LEAVE');
CREATE TYPE "HalfDaySession" AS ENUM ('FIRST_HALF', 'SECOND_HALF');
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

ALTER TABLE "LeaveRequest"
  ADD COLUMN "leaveType" "LeaveType" NOT NULL DEFAULT 'FULL_DAY',
  ADD COLUMN "halfDaySession" "HalfDaySession",
  ADD COLUMN "attachmentName" TEXT,
  ADD COLUMN "attachmentMime" TEXT,
  ADD COLUMN "attachmentData" BYTEA,
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3);

ALTER TABLE "LeaveRequest" ALTER COLUMN "status" DROP DEFAULT;
DO $$
DECLARE unexpected text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ' ORDER BY "status") INTO unexpected
  FROM "LeaveRequest" WHERE "status" NOT IN ('PENDING','APPROVED','REJECTED','CANCELLED');
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'LeaveRequest status migration blocked. Explicitly map these legacy values before deployment: %', unexpected;
  END IF;
END $$;
ALTER TABLE "LeaveRequest" ALTER COLUMN "status" TYPE "LeaveRequestStatus" USING
  "status"::"LeaveRequestStatus";
ALTER TABLE "LeaveRequest" ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE INDEX "LeaveRequest_approvedById_idx" ON "LeaveRequest"("approvedById");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
