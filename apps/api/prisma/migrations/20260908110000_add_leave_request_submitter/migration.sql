-- Preserve all historical leave requests. NULL means the submitter was not recorded.
ALTER TABLE "LeaveRequest" ADD COLUMN "submittedById" TEXT;

CREATE INDEX "LeaveRequest_submittedById_idx" ON "LeaveRequest"("submittedById");

ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_submittedById_fkey"
FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
