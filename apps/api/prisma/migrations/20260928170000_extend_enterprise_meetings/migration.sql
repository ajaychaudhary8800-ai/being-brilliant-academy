-- Extend enterprise meetings with recurrence templates, teams and invitation tracking.
ALTER TABLE "MeetingSeries"
  ADD COLUMN "template" JSONB NOT NULL,
  ADD COLUMN "lastGeneratedAt" TIMESTAMP(3),
  ADD COLUMN "generationHorizon" TIMESTAMP(3);

ALTER TABLE "Meeting"
  ADD COLUMN "occurrenceIndex" INTEGER;

CREATE UNIQUE INDEX "Meeting_seriesId_occurrenceIndex_key" ON "Meeting"("seriesId","occurrenceIndex");

CREATE TABLE "MeetingTeam" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "branchId" TEXT,
  "departmentId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingTeam_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingTeam_organizationId_name_key" ON "MeetingTeam"("organizationId","name");
CREATE INDEX "MeetingTeam_organizationId_branchId_departmentId_isActive_idx" ON "MeetingTeam"("organizationId","branchId","departmentId","isActive");

CREATE TABLE "MeetingTeamMember" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "addedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingTeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

CREATE INDEX "MeetingTeamMember_organizationId_userId_idx" ON "MeetingTeamMember"("organizationId","userId");

CREATE TABLE "MeetingInvite" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "notificationId" TEXT,
  "kind" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingInvite_meetingId_participantId_kind_key" ON "MeetingInvite"("meetingId","participantId","kind");
CREATE INDEX "MeetingInvite_organizationId_scheduledAt_status_idx" ON "MeetingInvite"("organizationId","scheduledAt","status");
CREATE INDEX "MeetingInvite_organizationId_meetingId_idx" ON "MeetingInvite"("organizationId","meetingId");

ALTER TABLE "MeetingTeamMember"
  ADD CONSTRAINT "MeetingTeamMember_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "MeetingTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MeetingInvite"
  ADD CONSTRAINT "MeetingInvite_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
