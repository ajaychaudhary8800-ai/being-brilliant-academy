-- Additive SchoolOS V5 coaching fields. Existing school layouts and records remain unchanged.
ALTER TABLE "Batch" ADD COLUMN "coachingGrades" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "StudentProfile" ADD COLUMN "coachingGrade" INTEGER;
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_coachingGrade_valid"
  CHECK ("coachingGrade" IS NULL OR "coachingGrade" BETWEEN 1 AND 12);
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_coachingGrades_count_valid"
  CHECK (cardinality("coachingGrades") <= 12);
