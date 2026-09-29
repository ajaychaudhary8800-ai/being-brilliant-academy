-- Enterprise staff and management meetings domain
CREATE TYPE "MeetingType" AS ENUM ('MANAGEMENT','STAFF','DEPARTMENT','HOD','TEACHER_COORDINATION','TRAINING','INTERVIEW','COMMITTEE','GENERAL','CUSTOM');
CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT','SCHEDULED','OPEN_FOR_JOIN','LIVE','ENDED','MINUTES_PENDING','MINUTES_PUBLISHED','CLOSED','CANCELLED');
CREATE TYPE "MeetingVisibility" AS ENUM ('INVITE_ONLY','ORGANIZATION','BRANCH','DEPARTMENT');
CREATE TYPE "MeetingParticipantKind" AS ENUM ('EMPLOYEE','TEACHER','MANAGEMENT','EXTERNAL_GUEST');
CREATE TYPE "MeetingParticipantRole" AS ENUM ('HOST','CO_HOST','PRESENTER','PARTICIPANT','OBSERVER');
CREATE TYPE "MeetingInvitationStatus" AS ENUM ('PENDING','SENT','FAILED');
CREATE TYPE "MeetingResponseStatus" AS ENUM ('PENDING','ACCEPTED','DECLINED','TENTATIVE');
CREATE TYPE "MeetingAudienceType" AS ENUM ('ORGANIZATION','BRANCH','DEPARTMENT','TEAM','ROLE','INDIVIDUAL');
CREATE TYPE "MeetingAttendanceStatus" AS ENUM ('PRESENT','PARTIAL','ABSENT','EXCUSED');
CREATE TYPE "MeetingMinutesStatus" AS ENUM ('DRAFT','UNDER_REVIEW','APPROVED','PUBLISHED');
CREATE TYPE "MeetingActionStatus" AS ENUM ('OPEN','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED');
CREATE TYPE "MeetingPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
CREATE TYPE "MeetingRecordingStatus" AS ENUM ('STARTING','RECORDING','PROCESSING','AVAILABLE','FAILED','DELETED');

CREATE TABLE "MeetingSeries" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "recurrenceRule" TEXT NOT NULL,
  "recurrenceStart" TIMESTAMP(3) NOT NULL,
  "recurrenceEnd" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Meeting" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "seriesId" TEXT,
  "branchId" TEXT,
  "departmentId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "MeetingType" NOT NULL DEFAULT 'GENERAL',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" "MeetingStatus" NOT NULL DEFAULT 'DRAFT',
  "visibility" "MeetingVisibility" NOT NULL DEFAULT 'INVITE_ONLY',
  "hostUserId" TEXT NOT NULL,
  "livekitRoomName" TEXT NOT NULL,
  "roomLocked" BOOLEAN NOT NULL DEFAULT false,
  "allowRecording" BOOLEAN NOT NULL DEFAULT false,
  "recordingRequired" BOOLEAN NOT NULL DEFAULT false,
  "allowChat" BOOLEAN NOT NULL DEFAULT true,
  "allowWhiteboard" BOOLEAN NOT NULL DEFAULT true,
  "allowAnnotation" BOOLEAN NOT NULL DEFAULT true,
  "allowScreenShare" BOOLEAN NOT NULL DEFAULT true,
  "allowParticipantMic" BOOLEAN NOT NULL DEFAULT true,
  "allowParticipantCamera" BOOLEAN NOT NULL DEFAULT true,
  "joinBeforeMinutes" INTEGER NOT NULL DEFAULT 10,
  "lockAfterStart" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAudience" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "type" "MeetingAudienceType" NOT NULL,
  "branchId" TEXT,
  "departmentId" TEXT,
  "teamId" TEXT,
  "role" TEXT,
  "valueId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingAudience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingParticipant" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "participantKind" "MeetingParticipantKind" NOT NULL,
  "meetingRole" "MeetingParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
  "invitationStatus" "MeetingInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "responseStatus" "MeetingResponseStatus" NOT NULL DEFAULT 'PENDING',
  "invitedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "declinedAt" TIMESTAMP(3),
  "addedById" TEXT NOT NULL,
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAgendaItem" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sequence" INTEGER NOT NULL,
  "presenterUserId" TEXT,
  "plannedMinutes" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingAgendaItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAttachment" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "agendaItemId" TEXT,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'PARTICIPANTS',
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAttendanceSession" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'LIVEKIT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingAttendanceSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingMinutes" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "summary" TEXT,
  "notes" TEXT,
  "status" "MeetingMinutesStatus" NOT NULL DEFAULT 'DRAFT',
  "preparedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "preparedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingMinutes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingDecision" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "agendaItemId" TEXT,
  "decision" TEXT NOT NULL,
  "rationale" TEXT,
  "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingActionItem" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "decisionId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assigneeUserId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3),
  "priority" "MeetingPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "MeetingActionStatus" NOT NULL DEFAULT 'OPEN',
  "completedAt" TIMESTAMP(3),
  "completionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingRecording" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'LIVEKIT',
  "providerRecordingId" TEXT,
  "status" "MeetingRecordingStatus" NOT NULL DEFAULT 'STARTING',
  "startedAt" TIMESTAMP(3),
  "stoppedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "storageKey" TEXT,
  "sizeBytes" BIGINT,
  "initiatedById" TEXT NOT NULL,
  "retentionUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAuditLog" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Meeting_organizationId_livekitRoomName_key" ON "Meeting"("organizationId","livekitRoomName");
CREATE INDEX "Meeting_organizationId_startsAt_idx" ON "Meeting"("organizationId","startsAt");
CREATE INDEX "Meeting_organizationId_branchId_startsAt_idx" ON "Meeting"("organizationId","branchId","startsAt");
CREATE INDEX "Meeting_organizationId_departmentId_startsAt_idx" ON "Meeting"("organizationId","departmentId","startsAt");
CREATE INDEX "Meeting_organizationId_status_idx" ON "Meeting"("organizationId","status");
CREATE INDEX "Meeting_organizationId_hostUserId_startsAt_idx" ON "Meeting"("organizationId","hostUserId","startsAt");
CREATE INDEX "MeetingSeries_organizationId_isActive_idx" ON "MeetingSeries"("organizationId","isActive");
CREATE INDEX "MeetingSeries_organizationId_recurrenceStart_idx" ON "MeetingSeries"("organizationId","recurrenceStart");
CREATE INDEX "MeetingAudience_organizationId_meetingId_idx" ON "MeetingAudience"("organizationId","meetingId");
CREATE INDEX "MeetingAudience_organizationId_branchId_departmentId_idx" ON "MeetingAudience"("organizationId","branchId","departmentId");
CREATE UNIQUE INDEX "MeetingParticipant_meetingId_userId_key" ON "MeetingParticipant"("meetingId","userId");
CREATE INDEX "MeetingParticipant_organizationId_userId_createdAt_idx" ON "MeetingParticipant"("organizationId","userId","createdAt");
CREATE INDEX "MeetingParticipant_organizationId_meetingId_meetingRole_idx" ON "MeetingParticipant"("organizationId","meetingId","meetingRole");
CREATE UNIQUE INDEX "MeetingAgendaItem_meetingId_sequence_key" ON "MeetingAgendaItem"("meetingId","sequence");
CREATE INDEX "MeetingAgendaItem_organizationId_meetingId_idx" ON "MeetingAgendaItem"("organizationId","meetingId");
CREATE INDEX "MeetingAttachment_organizationId_meetingId_idx" ON "MeetingAttachment"("organizationId","meetingId");
CREATE INDEX "MeetingAttendanceSession_organizationId_meetingId_participantId_idx" ON "MeetingAttendanceSession"("organizationId","meetingId","participantId");
CREATE INDEX "MeetingAttendanceSession_organizationId_participantId_joinedAt_idx" ON "MeetingAttendanceSession"("organizationId","participantId","joinedAt");
CREATE UNIQUE INDEX "MeetingMinutes_meetingId_key" ON "MeetingMinutes"("meetingId");
CREATE INDEX "MeetingMinutes_organizationId_status_idx" ON "MeetingMinutes"("organizationId","status");
CREATE INDEX "MeetingDecision_organizationId_meetingId_createdAt_idx" ON "MeetingDecision"("organizationId","meetingId","createdAt");
CREATE INDEX "MeetingActionItem_organizationId_assigneeUserId_status_dueAt_idx" ON "MeetingActionItem"("organizationId","assigneeUserId","status","dueAt");
CREATE INDEX "MeetingActionItem_organizationId_meetingId_idx" ON "MeetingActionItem"("organizationId","meetingId");
CREATE INDEX "MeetingRecording_organizationId_meetingId_createdAt_idx" ON "MeetingRecording"("organizationId","meetingId","createdAt");
CREATE INDEX "MeetingRecording_organizationId_status_idx" ON "MeetingRecording"("organizationId","status");
CREATE INDEX "MeetingAuditLog_organizationId_meetingId_createdAt_idx" ON "MeetingAuditLog"("organizationId","meetingId","createdAt");
CREATE INDEX "MeetingAuditLog_organizationId_actorUserId_createdAt_idx" ON "MeetingAuditLog"("organizationId","actorUserId","createdAt");

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MeetingSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingAudience" ADD CONSTRAINT "MeetingAudience_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttachment" ADD CONSTRAINT "MeetingAttachment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendanceSession" ADD CONSTRAINT "MeetingAttendanceSession_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "MeetingDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAuditLog" ADD CONSTRAINT "MeetingAuditLog_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
