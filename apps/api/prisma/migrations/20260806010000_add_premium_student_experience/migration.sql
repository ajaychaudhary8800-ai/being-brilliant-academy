-- CreateTable
CREATE TABLE "PremiumLead" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "className" TEXT,
    "targetExam" TEXT,
    "branchId" TEXT,
    "courseId" TEXT,
    "demoAt" TIMESTAMP(3),
    "trialRequested" BOOLEAN NOT NULL DEFAULT false,
    "couponCode" TEXT,
    "referralCode" TEXT,
    "emiRequested" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "leadScore" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "crmSyncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "crmExternalId" TEXT,
    "utm" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumCoupon" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "minimumPaise" INTEGER NOT NULL DEFAULT 0,
    "maximumPaise" INTEGER,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "usageLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PremiumCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumReferral" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "rewardPaise" INTEGER NOT NULL DEFAULT 0,
    "referredCount" INTEGER NOT NULL DEFAULT 0,
    "convertedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PremiumReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoTimestampBookmark" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "positionSeconds" INTEGER NOT NULL,
    "label" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoTimestampBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonAiAsset" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonAiAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyEngagement" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "questionId" TEXT,
    "challengeTitle" TEXT NOT NULL,
    "challengeBody" TEXT NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyEngagementResponse" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answer" JSONB,
    "correct" BOOLEAN,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyEngagementResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PremiumLead_organizationId_status_leadScore_idx" ON "PremiumLead"("organizationId", "status", "leadScore");

-- CreateIndex
CREATE INDEX "PremiumLead_organizationId_mobile_createdAt_idx" ON "PremiumLead"("organizationId", "mobile", "createdAt");

-- CreateIndex
CREATE INDEX "PremiumLead_organizationId_email_idx" ON "PremiumLead"("organizationId", "email");

-- CreateIndex
CREATE INDEX "PremiumCoupon_organizationId_isActive_validUntil_idx" ON "PremiumCoupon"("organizationId", "isActive", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumCoupon_organizationId_code_key" ON "PremiumCoupon"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PremiumReferral_organizationId_ownerUserId_isActive_idx" ON "PremiumReferral"("organizationId", "ownerUserId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumReferral_organizationId_code_key" ON "PremiumReferral"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_organizationId_userId_isActive_idx" ON "PushSubscription"("organizationId", "userId", "isActive");

-- CreateIndex
CREATE INDEX "VideoTimestampBookmark_organizationId_userId_lessonId_idx" ON "VideoTimestampBookmark"("organizationId", "userId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoTimestampBookmark_userId_lessonId_positionSeconds_key" ON "VideoTimestampBookmark"("userId", "lessonId", "positionSeconds");

-- CreateIndex
CREATE INDEX "LessonAiAsset_organizationId_lessonId_idx" ON "LessonAiAsset"("organizationId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonAiAsset_organizationId_lessonId_type_key" ON "LessonAiAsset"("organizationId", "lessonId", "type");

-- CreateIndex
CREATE INDEX "DailyEngagement_organizationId_active_date_idx" ON "DailyEngagement"("organizationId", "active", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyEngagement_organizationId_date_key" ON "DailyEngagement"("organizationId", "date");

-- CreateIndex
CREATE INDEX "DailyEngagementResponse_organizationId_userId_submittedAt_idx" ON "DailyEngagementResponse"("organizationId", "userId", "submittedAt");

-- CreateIndex
CREATE INDEX "DailyEngagementResponse_organizationId_engagementId_score_idx" ON "DailyEngagementResponse"("organizationId", "engagementId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "DailyEngagementResponse_engagementId_userId_key" ON "DailyEngagementResponse"("engagementId", "userId");
