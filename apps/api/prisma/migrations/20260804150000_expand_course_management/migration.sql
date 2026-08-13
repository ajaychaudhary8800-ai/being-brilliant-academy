-- Course Management expansion. Existing legacy values are converted before the enum-backed fields are used.
DO $$ BEGIN
  CREATE TYPE "CourseMode" AS ENUM ('ONLINE', 'OFFLINE', 'HYBRID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ClassLevel" AS ENUM ('CLASS_6','CLASS_7','CLASS_8','CLASS_9','CLASS_10','CLASS_11','CLASS_12','GRADUATE','POSTGRADUATE','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "courseCode" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "shortDescription" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "classLevel" "ClassLevel" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "stream" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "registrationFeePaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "admissionFeePaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "brochureUrl" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "eligibility" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "learningOutcomes" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "mode" "CourseMode" NOT NULL DEFAULT 'HYBRID';
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "enrollmentOpen" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
UPDATE "Course" SET "courseCode" = COALESCE("courseCode", 'COURSE-' || substr("id", 1, 8));
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Course'
      AND column_name = 'published'
  ) THEN
    EXECUTE 'UPDATE "Course" SET "status" = CASE WHEN "published" THEN ''ACTIVE''::"CourseStatus" ELSE ''DRAFT''::"CourseStatus" END';
  END IF;
END $$;
ALTER TABLE "Course" ALTER COLUMN "courseCode" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Course_courseCode_key" ON "Course"("courseCode");
CREATE INDEX IF NOT EXISTS "Course_status_idx" ON "Course"("status");
CREATE INDEX IF NOT EXISTS "Course_branchId_idx" ON "Course"("branchId");
CREATE TABLE IF NOT EXISTS "Subject" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Subject_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX IF NOT EXISTS "Subject_code_key" ON "Subject"("code");
CREATE TABLE IF NOT EXISTS "CourseSubject" ("courseId" TEXT NOT NULL, "subjectId" TEXT NOT NULL, "teacherId" TEXT, "position" INTEGER NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true, CONSTRAINT "CourseSubject_pkey" PRIMARY KEY ("courseId","subjectId"));
