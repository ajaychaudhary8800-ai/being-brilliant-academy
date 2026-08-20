CREATE TYPE "AnswerSheetStatus" AS ENUM ('SUBMITTED', 'LATE_SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'RETURNED');

CREATE TABLE "ExaminationQuestionPaper" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "examinationId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileData" BYTEA NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExaminationQuestionPaper_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExaminationAnswerSheet" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "examinationId" TEXT NOT NULL,
  "questionPaperId" TEXT,
  "studentId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileData" BYTEA NOT NULL,
  "studentRemarks" TEXT,
  "status" "AnswerSheetStatus" NOT NULL DEFAULT 'SUBMITTED',
  "isLate" BOOLEAN NOT NULL DEFAULT false,
  "marksObtained" DECIMAL(8,2),
  "teacherRemarks" TEXT,
  "internalNotes" TEXT,
  "evaluatedById" TEXT,
  "evaluatedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExaminationAnswerSheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExaminationQuestionPaper_examinationId_key" ON "ExaminationQuestionPaper"("examinationId");
CREATE INDEX "ExaminationQuestionPaper_organizationId_createdAt_idx" ON "ExaminationQuestionPaper"("organizationId", "createdAt");
CREATE INDEX "ExaminationQuestionPaper_uploadedById_idx" ON "ExaminationQuestionPaper"("uploadedById");
CREATE UNIQUE INDEX "ExaminationAnswerSheet_examinationId_studentId_key" ON "ExaminationAnswerSheet"("examinationId", "studentId");
CREATE INDEX "ExaminationAnswerSheet_organizationId_status_submittedAt_idx" ON "ExaminationAnswerSheet"("organizationId", "status", "submittedAt");
CREATE INDEX "ExaminationAnswerSheet_studentId_submittedAt_idx" ON "ExaminationAnswerSheet"("studentId", "submittedAt");
CREATE INDEX "ExaminationAnswerSheet_evaluatedById_idx" ON "ExaminationAnswerSheet"("evaluatedById");

ALTER TABLE "ExaminationQuestionPaper" ADD CONSTRAINT "ExaminationQuestionPaper_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExaminationQuestionPaper" ADD CONSTRAINT "ExaminationQuestionPaper_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExaminationQuestionPaper" ADD CONSTRAINT "ExaminationQuestionPaper_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExaminationAnswerSheet" ADD CONSTRAINT "ExaminationAnswerSheet_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "Examination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExaminationAnswerSheet" ADD CONSTRAINT "ExaminationAnswerSheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExaminationAnswerSheet" ADD CONSTRAINT "ExaminationAnswerSheet_questionPaperId_fkey" FOREIGN KEY ("questionPaperId") REFERENCES "ExaminationQuestionPaper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExaminationAnswerSheet" ADD CONSTRAINT "ExaminationAnswerSheet_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExaminationAnswerSheet" ADD CONSTRAINT "ExaminationAnswerSheet_evaluatedById_fkey" FOREIGN KEY ("evaluatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
