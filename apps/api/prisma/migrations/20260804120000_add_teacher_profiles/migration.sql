CREATE TABLE IF NOT EXISTS "TeacherProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeNo" TEXT NOT NULL,
  "qualification" TEXT,
  "specialization" TEXT,
  "branchId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeacherProfile_userId_key" ON "TeacherProfile"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "TeacherProfile_employeeNo_key" ON "TeacherProfile"("employeeNo");
CREATE INDEX IF NOT EXISTS "TeacherProfile_branchId_specialization_idx" ON "TeacherProfile"("branchId", "specialization");

DO $$ BEGIN
  ALTER TABLE "TeacherProfile" ADD CONSTRAINT "TeacherProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TeacherProfile" ADD CONSTRAINT "TeacherProfile_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
