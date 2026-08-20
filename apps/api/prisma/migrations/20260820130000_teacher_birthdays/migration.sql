ALTER TABLE "TeacherProfile" ADD COLUMN "dateOfBirth" DATE;
CREATE INDEX "TeacherProfile_dateOfBirth_idx" ON "TeacherProfile"("dateOfBirth");
