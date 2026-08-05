-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "branchId" TEXT,
    "academicYear" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "dimensions" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAnalyticsProfile" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "performanceScore" DOUBLE PRECISION NOT NULL,
    "predictedPercentage" DOUBLE PRECISION NOT NULL,
    "attendanceRisk" DOUBLE PRECISION NOT NULL,
    "overallRisk" DOUBLE PRECISION NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "weakSubjects" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentAnalyticsProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAnalyticsProfile" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "performanceScore" DOUBLE PRECISION NOT NULL,
    "workloadScore" DOUBLE PRECISION NOT NULL,
    "completionScore" DOUBLE PRECISION NOT NULL,
    "homeworkEfficiency" DOUBLE PRECISION NOT NULL,
    "studentOutcomeScore" DOUBLE PRECISION NOT NULL,
    "feedbackSentiment" DOUBLE PRECISION,
    "evidence" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherAnalyticsProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsForecast" (
    "id" TEXT NOT NULL,
    "branchId" TEXT,
    "domain" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "predictedValue" DECIMAL(18,2) NOT NULL,
    "lowerBound" DECIMAL(18,2),
    "upperBound" DECIMAL(18,2),
    "confidence" DOUBLE PRECISION NOT NULL,
    "assumptions" JSONB,
    "modelVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSavedReport" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataset" TEXT NOT NULL,
    "columns" TEXT[],
    "filters" JSONB,
    "groupBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort" JSONB,
    "visualization" TEXT NOT NULL DEFAULT 'TABLE',
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsReportSchedule" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Calcutta',
    "format" TEXT NOT NULL DEFAULT 'PDF',
    "recipients" TEXT[],
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AnalyticsReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsAssistantQuery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "parameters" JSONB,
    "answer" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "suggestedActions" JSONB,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsAssistantQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceEntityId" TEXT,
    "evidence" JSONB,
    "actionUrl" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_scope_generatedAt_idx" ON "AnalyticsSnapshot"("scope", "generatedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_expiresAt_idx" ON "AnalyticsSnapshot"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSnapshot_branchId_academicYear_scope_periodStart_p_key" ON "AnalyticsSnapshot"("branchId", "academicYear", "scope", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAnalyticsProfile_studentId_key" ON "StudentAnalyticsProfile"("studentId");

-- CreateIndex
CREATE INDEX "StudentAnalyticsProfile_riskLevel_overallRisk_idx" ON "StudentAnalyticsProfile"("riskLevel", "overallRisk");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAnalyticsProfile_teacherId_key" ON "TeacherAnalyticsProfile"("teacherId");

-- CreateIndex
CREATE INDEX "TeacherAnalyticsProfile_performanceScore_idx" ON "TeacherAnalyticsProfile"("performanceScore");

-- CreateIndex
CREATE INDEX "AnalyticsForecast_domain_period_idx" ON "AnalyticsForecast"("domain", "period");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsForecast_branchId_domain_metric_period_key" ON "AnalyticsForecast"("branchId", "domain", "metric", "period");

-- CreateIndex
CREATE INDEX "AnalyticsSavedReport_dataset_isArchived_idx" ON "AnalyticsSavedReport"("dataset", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSavedReport_ownerId_name_key" ON "AnalyticsSavedReport"("ownerId", "name");

-- CreateIndex
CREATE INDEX "AnalyticsReportSchedule_active_nextRunAt_idx" ON "AnalyticsReportSchedule"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "AnalyticsAssistantQuery_userId_createdAt_idx" ON "AnalyticsAssistantQuery"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsAlert_userId_acknowledgedAt_createdAt_idx" ON "AnalyticsAlert"("userId", "acknowledgedAt", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsAlert_type_severity_idx" ON "AnalyticsAlert"("type", "severity");

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSavedReport" ADD CONSTRAINT "AnalyticsSavedReport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsReportSchedule" ADD CONSTRAINT "AnalyticsReportSchedule_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AnalyticsSavedReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsAssistantQuery" ADD CONSTRAINT "AnalyticsAssistantQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsAlert" ADD CONSTRAINT "AnalyticsAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
