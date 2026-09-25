-- Step 10: dedicated platform SaaS sales acquisition pipeline.
-- Keeps B2B platform prospects separate from tenant admissions CRM and legacy learner leads.

CREATE TABLE "SaaSSalesLead" (
    "id" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "institutionType" TEXT NOT NULL,
    "studentCountBand" TEXT,
    "city" TEXT,
    "state" TEXT,
    "website" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "campaign" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "qualification" TEXT NOT NULL DEFAULT 'UNQUALIFIED',
    "leadScore" INTEGER NOT NULL DEFAULT 0,
    "recommendedPlan" TEXT,
    "expectedAnnualValuePaise" INTEGER,
    "nextFollowUpAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "ownerUserId" TEXT,
    "notes" TEXT,
    "lostReason" TEXT,
    "wonOrganizationId" TEXT,
    "requirements" JSONB,
    "utm" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaaSSalesLead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaaSSalesActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "outcome" TEXT,
    "notes" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaaSSalesActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaaSSalesLead_status_qualification_leadScore_idx"
ON "SaaSSalesLead"("status", "qualification", "leadScore");

CREATE INDEX "SaaSSalesLead_source_createdAt_idx"
ON "SaaSSalesLead"("source", "createdAt");

CREATE INDEX "SaaSSalesLead_nextFollowUpAt_status_idx"
ON "SaaSSalesLead"("nextFollowUpAt", "status");

CREATE INDEX "SaaSSalesLead_mobile_createdAt_idx"
ON "SaaSSalesLead"("mobile", "createdAt");

CREATE INDEX "SaaSSalesLead_email_idx"
ON "SaaSSalesLead"("email");

CREATE INDEX "SaaSSalesActivity_leadId_createdAt_idx"
ON "SaaSSalesActivity"("leadId", "createdAt");

ALTER TABLE "SaaSSalesActivity"
ADD CONSTRAINT "SaaSSalesActivity_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "SaaSSalesLead"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
