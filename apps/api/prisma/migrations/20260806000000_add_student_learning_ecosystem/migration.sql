-- CreateEnum
CREATE TYPE "LearningStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DoubtStatus" AS ENUM ('OPEN', 'ANSWERED', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "LearningTestType" AS ENUM ('PRACTICE', 'CHAPTER', 'UNIT', 'FULL', 'MOCK', 'ADAPTIVE');

-- CreateEnum
CREATE TYPE "LearningAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EVALUATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StudyMaterialType" AS ENUM ('PDF', 'NOTES', 'FORMULA_SHEET', 'MIND_MAP', 'ASSIGNMENT', 'DPP', 'NCERT_SOLUTION', 'PYQ', 'SAMPLE_PAPER', 'REFERENCE_BOOK', 'BLOG', 'VIDEO');

-- CreateEnum
CREATE TYPE "LiveClassProvider" AS ENUM ('ZOOM', 'GOOGLE_MEET', 'JITSI', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "DoubtThread" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT,
    "chapter" TEXT,
    "topic" TEXT,
    "title" TEXT NOT NULL,
    "status" "DoubtStatus" NOT NULL DEFAULT 'OPEN',
    "bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "assignedTeacherId" TEXT,
    "confidence" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoubtThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoubtMessage" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachmentName" TEXT,
    "attachmentMime" TEXT,
    "attachmentData" BYTEA,
    "confidence" DECIMAL(5,2),
    "sources" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoubtMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionBankItem" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "examCategory" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "courseId" TEXT,
    "chapter" TEXT NOT NULL,
    "topic" TEXT,
    "difficulty" TEXT NOT NULL,
    "marks" DECIMAL(6,2) NOT NULL,
    "negativeMarks" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "year" INTEGER,
    "source" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bloomLevel" TEXT,
    "body" TEXT NOT NULL,
    "options" JSONB,
    "correctAnswer" JSONB NOT NULL,
    "solution" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionBankItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionBankRevision" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionBankRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningTest" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LearningTestType" NOT NULL,
    "branchId" TEXT,
    "courseId" TEXT NOT NULL,
    "batchId" TEXT,
    "subjectId" TEXT,
    "chapter" TEXT,
    "instructions" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "maximumMarks" DECIMAL(7,2) NOT NULL,
    "passingMarks" DECIMAL(7,2) NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "adaptive" BOOLEAN NOT NULL DEFAULT false,
    "status" "LearningStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningTestQuestion" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "testId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'General',
    "position" INTEGER NOT NULL,
    "marks" DECIMAL(6,2) NOT NULL,
    "negativeMarks" DECIMAL(6,2) NOT NULL DEFAULT 0,

    CONSTRAINT "LearningTestQuestion_pkey" PRIMARY KEY ("testId","questionId")
);

-- CreateTable
CREATE TABLE "LearningTestAttempt" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "LearningAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "score" DECIMAL(7,2),
    "percentage" DECIMAL(6,2),
    "percentile" DECIMAL(6,2),
    "rank" INTEGER,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectCount" INTEGER NOT NULL DEFAULT 0,
    "unansweredCount" INTEGER NOT NULL DEFAULT 0,
    "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LearningTestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningTestAnswer" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" JSONB,
    "markedForReview" BOOLEAN NOT NULL DEFAULT false,
    "bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0,
    "awardedMarks" DECIMAL(6,2),
    "isCorrect" BOOLEAN,

    CONSTRAINT "LearningTestAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyMaterial" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "StudyMaterialType" NOT NULL,
    "branchId" TEXT,
    "courseId" TEXT NOT NULL,
    "batchId" TEXT,
    "subjectId" TEXT,
    "chapter" TEXT,
    "topic" TEXT,
    "teacherId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "LearningStatus" NOT NULL DEFAULT 'DRAFT',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "fileData" BYTEA,
    "externalUrl" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyMaterialBookmark" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "materialId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyMaterialBookmark_pkey" PRIMARY KEY ("materialId","userId")
);

-- CreateTable
CREATE TABLE "LiveClass" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "provider" "LiveClassProvider" NOT NULL,
    "meetingUrl" TEXT NOT NULL,
    "meetingId" TEXT,
    "meetingPassword" TEXT,
    "branchId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "recordingUrl" TEXT,
    "whiteboardUrl" TEXT,
    "status" "LearningStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveClassAttendance" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LiveClassAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveClassInteraction" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveClassInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamificationProfile" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" DATE,
    "level" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamificationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningBadge" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "xpRequired" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LearningBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentBadge" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "badgeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentBadge_pkey" PRIMARY KEY ("badgeId","userId")
);

-- CreateTable
CREATE TABLE "LearningChallenge" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "coinReward" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LearningChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeProgress" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ChallengeProgress_pkey" PRIMARY KEY ("challengeId","userId")
);

-- CreateTable
CREATE TABLE "LearningRecommendation" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLearningGoal" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "targetMinutes" INTEGER NOT NULL DEFAULT 60,
    "completedMinutes" INTEGER NOT NULL DEFAULT 0,
    "targetQuestions" INTEGER NOT NULL DEFAULT 20,
    "completedQuestions" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DailyLearningGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoubtThread_organizationId_studentId_updatedAt_idx" ON "DoubtThread"("organizationId", "studentId", "updatedAt");

-- CreateIndex
CREATE INDEX "DoubtThread_organizationId_subjectId_chapter_idx" ON "DoubtThread"("organizationId", "subjectId", "chapter");

-- CreateIndex
CREATE INDEX "DoubtThread_organizationId_status_assignedTeacherId_idx" ON "DoubtThread"("organizationId", "status", "assignedTeacherId");

-- CreateIndex
CREATE INDEX "DoubtMessage_organizationId_threadId_createdAt_idx" ON "DoubtMessage"("organizationId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionBankItem_organizationId_examCategory_subjectId_chap_idx" ON "QuestionBankItem"("organizationId", "examCategory", "subjectId", "chapter");

-- CreateIndex
CREATE INDEX "QuestionBankItem_organizationId_difficulty_approvalStatus_idx" ON "QuestionBankItem"("organizationId", "difficulty", "approvalStatus");

-- CreateIndex
CREATE INDEX "QuestionBankItem_organizationId_createdAt_idx" ON "QuestionBankItem"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBankItem_organizationId_code_key" ON "QuestionBankItem"("organizationId", "code");

-- CreateIndex
CREATE INDEX "QuestionBankRevision_organizationId_questionId_idx" ON "QuestionBankRevision"("organizationId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBankRevision_questionId_version_key" ON "QuestionBankRevision"("questionId", "version");

-- CreateIndex
CREATE INDEX "LearningTest_organizationId_courseId_batchId_status_idx" ON "LearningTest"("organizationId", "courseId", "batchId", "status");

-- CreateIndex
CREATE INDEX "LearningTest_organizationId_subjectId_chapter_idx" ON "LearningTest"("organizationId", "subjectId", "chapter");

-- CreateIndex
CREATE UNIQUE INDEX "LearningTest_organizationId_code_key" ON "LearningTest"("organizationId", "code");

-- CreateIndex
CREATE INDEX "LearningTestQuestion_organizationId_testId_section_idx" ON "LearningTestQuestion"("organizationId", "testId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "LearningTestQuestion_testId_position_key" ON "LearningTestQuestion"("testId", "position");

-- CreateIndex
CREATE INDEX "LearningTestAttempt_organizationId_studentId_submittedAt_idx" ON "LearningTestAttempt"("organizationId", "studentId", "submittedAt");

-- CreateIndex
CREATE INDEX "LearningTestAttempt_organizationId_testId_score_idx" ON "LearningTestAttempt"("organizationId", "testId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "LearningTestAttempt_testId_studentId_startedAt_key" ON "LearningTestAttempt"("testId", "studentId", "startedAt");

-- CreateIndex
CREATE INDEX "LearningTestAnswer_organizationId_attemptId_idx" ON "LearningTestAnswer"("organizationId", "attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningTestAnswer_attemptId_questionId_key" ON "LearningTestAnswer"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "StudyMaterial_organizationId_courseId_batchId_status_idx" ON "StudyMaterial"("organizationId", "courseId", "batchId", "status");

-- CreateIndex
CREATE INDEX "StudyMaterial_organizationId_subjectId_chapter_type_idx" ON "StudyMaterial"("organizationId", "subjectId", "chapter", "type");

-- CreateIndex
CREATE INDEX "StudyMaterial_organizationId_createdAt_idx" ON "StudyMaterial"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StudyMaterialBookmark_organizationId_userId_idx" ON "StudyMaterialBookmark"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "LiveClass_organizationId_batchId_startsAt_idx" ON "LiveClass"("organizationId", "batchId", "startsAt");

-- CreateIndex
CREATE INDEX "LiveClass_organizationId_teacherId_startsAt_idx" ON "LiveClass"("organizationId", "teacherId", "startsAt");

-- CreateIndex
CREATE INDEX "LiveClass_organizationId_status_idx" ON "LiveClass"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LiveClassAttendance_organizationId_userId_joinedAt_idx" ON "LiveClassAttendance"("organizationId", "userId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveClassAttendance_liveClassId_userId_key" ON "LiveClassAttendance"("liveClassId", "userId");

-- CreateIndex
CREATE INDEX "LiveClassInteraction_organizationId_liveClassId_createdAt_idx" ON "LiveClassInteraction"("organizationId", "liveClassId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GamificationProfile_userId_key" ON "GamificationProfile"("userId");

-- CreateIndex
CREATE INDEX "GamificationProfile_organizationId_xp_idx" ON "GamificationProfile"("organizationId", "xp");

-- CreateIndex
CREATE INDEX "LearningBadge_organizationId_isActive_idx" ON "LearningBadge"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LearningBadge_organizationId_code_key" ON "LearningBadge"("organizationId", "code");

-- CreateIndex
CREATE INDEX "StudentBadge_organizationId_userId_idx" ON "StudentBadge"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "LearningChallenge_organizationId_isActive_startsAt_endsAt_idx" ON "LearningChallenge"("organizationId", "isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ChallengeProgress_organizationId_userId_idx" ON "ChallengeProgress"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "LearningRecommendation_organizationId_userId_completedAt_pr_idx" ON "LearningRecommendation"("organizationId", "userId", "completedAt", "priority");

-- CreateIndex
CREATE INDEX "DailyLearningGoal_organizationId_date_idx" ON "DailyLearningGoal"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLearningGoal_userId_date_key" ON "DailyLearningGoal"("userId", "date");

-- AddForeignKey
ALTER TABLE "DoubtThread" ADD CONSTRAINT "DoubtThread_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubtThread" ADD CONSTRAINT "DoubtThread_assignedTeacherId_fkey" FOREIGN KEY ("assignedTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubtMessage" ADD CONSTRAINT "DoubtMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DoubtThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubtMessage" ADD CONSTRAINT "DoubtMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionBankItem" ADD CONSTRAINT "QuestionBankItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionBankItem" ADD CONSTRAINT "QuestionBankItem_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionBankRevision" ADD CONSTRAINT "QuestionBankRevision_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionBankItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningTest" ADD CONSTRAINT "LearningTest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningTestQuestion" ADD CONSTRAINT "LearningTestQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LearningTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningTestQuestion" ADD CONSTRAINT "LearningTestQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionBankItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningTestAttempt" ADD CONSTRAINT "LearningTestAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LearningTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningTestAttempt" ADD CONSTRAINT "LearningTestAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningTestAnswer" ADD CONSTRAINT "LearningTestAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "LearningTestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterialBookmark" ADD CONSTRAINT "StudyMaterialBookmark_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "StudyMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterialBookmark" ADD CONSTRAINT "StudyMaterialBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClassAttendance" ADD CONSTRAINT "LiveClassAttendance_liveClassId_fkey" FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClassAttendance" ADD CONSTRAINT "LiveClassAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClassInteraction" ADD CONSTRAINT "LiveClassInteraction_liveClassId_fkey" FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClassInteraction" ADD CONSTRAINT "LiveClassInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamificationProfile" ADD CONSTRAINT "GamificationProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentBadge" ADD CONSTRAINT "StudentBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "LearningBadge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentBadge" ADD CONSTRAINT "StudentBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeProgress" ADD CONSTRAINT "ChallengeProgress_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "LearningChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeProgress" ADD CONSTRAINT "ChallengeProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningRecommendation" ADD CONSTRAINT "LearningRecommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLearningGoal" ADD CONSTRAINT "DailyLearningGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
