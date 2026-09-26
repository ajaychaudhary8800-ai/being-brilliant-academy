-- AlterTable
ALTER TABLE "AutomationRule"
ADD COLUMN "cooldownMinutes" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN "lastRunAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AutomationDispatch" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "notificationId" TEXT,
    "nextEligibleAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationDispatch_organizationId_ruleId_entityId_recipientId_key"
ON "AutomationDispatch"("organizationId", "ruleId", "entityId", "recipientId");

-- CreateIndex
CREATE INDEX "AutomationDispatch_organizationId_ruleId_nextEligibleAt_idx"
ON "AutomationDispatch"("organizationId", "ruleId", "nextEligibleAt");

-- AddForeignKey
ALTER TABLE "AutomationDispatch"
ADD CONSTRAINT "AutomationDispatch_organizationId_ruleId_fkey"
FOREIGN KEY ("organizationId", "ruleId")
REFERENCES "AutomationRule"("organizationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
