-- CreateTable
CREATE TABLE "AutomationRule" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "actionType" TEXT NOT NULL DEFAULT 'NOTIFICATION',
    "actionConfig" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "lastPreviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PREVIEW',
    "status" TEXT NOT NULL,
    "triggerKey" TEXT,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_organizationId_id_key" ON "AutomationRule"("organizationId", "id");
CREATE UNIQUE INDEX "AutomationRule_organizationId_name_key" ON "AutomationRule"("organizationId", "name");
CREATE INDEX "AutomationRule_organizationId_active_triggerType_idx" ON "AutomationRule"("organizationId", "active", "triggerType");
CREATE INDEX "AutomationRun_organizationId_ruleId_startedAt_idx" ON "AutomationRun"("organizationId", "ruleId", "startedAt");
CREATE INDEX "AutomationRun_status_startedAt_idx" ON "AutomationRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_organizationId_ruleId_fkey"
FOREIGN KEY ("organizationId", "ruleId") REFERENCES "AutomationRule"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
