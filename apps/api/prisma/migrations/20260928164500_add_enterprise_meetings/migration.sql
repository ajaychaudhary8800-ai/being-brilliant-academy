-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('MANAGEMENT','STAFF','DEPARTMENT','HOD','TEACHER_COORDINATION','TRAINING','INTERVIEW','COMMITTEE','GENERAL','CUSTOM');
CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT','SCHEDULED','OPEN_FOR_JOIN','LIVE','ENDED','MINUTES_PENDING','MINUTES_PUBLISHED','CLOSED','CANCELLED');
CREATE TYPE "MeetingVisibility" AS ENUM ('INVITE_ONLY','ORGANIZATION','BRANCH','DEPARTMENT');
CREATE TYPE "MeetingAudienceType" AS ENUM ('ORGANIZATION','BRANCH','DEPARTMENT','TEAM','ROLE','INDIVIDUAL');
CREATE TYPE "MeetingParticipantType" AS ENUM ('EMPLOYEE','TEACHER','MANAGEMENT','EXTERNAL_GUEST');
CREATE TYPE "MeetingParticipantRole" AS ENUM ('HOST','CO_HOST','PRESENTER','PARTICIPANT','OBSERVER');
CREATE TYPE "MeetingInvitationStatus" AS ENUM ('PENDING','SENT','DELIVERED','FAILED','CANCELLED');
CREATE TYPE "MeetingResponseStatus" AS ENUM ('PENDING','ACCEPTED','DECLINED','TENTATIVE');
CREATE TYPE "MeetingAgendaStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED','SKIPPED');
CREATE TYPE "MeetingAttendanceStatus" AS ENUM ('PRESENT','PARTIAL','ABSENT','EXCUSED');
CREATE TYPE "MeetingMinutesStatus" AS ENUM ('DRAFT','UNDER_REVIEW','APPROVED','PUBLISHED');
CREATE TYPE "MeetingActionStatus" AS ENUM ('OPEN','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED');
CREATE TYPE "MeetingActionPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
CREATE TYPE "MeetingRecordingStatus" AS ENUM ('STARTING','RECORDING','PROCESSING','AVAILABLE','FAILED','DELETED');
CREATE TYPE "MeetingCalendarProvider" AS ENUM ('INTERNAL','GOOGLE','MICROSOFT','ICAL');
CREATE TYPE "MeetingSyncStatus" AS ENUM ('PENDING','SYNCED','FAILED');

CREATE TABLE "MeetingSeries" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "branchId" TEXT,
  "departmentId" TEXT,
  "timezone" TEXT NOT NULL,
  "recurrenceRule" TEXT NOT NULL,
  "recurrenceStart" TIMESTAMP(3),
  "recurrenceEnd" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Meeting" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "seriesId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "MeetingType" NOT NULL DEFAULT 'GENERAL',
  "branchId" TEXT,
  "departmentId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" "MeetingStatus" NOT NULL DEFAULT 'DRAFT',
  "visibility" "MeetingVisibility" NOT NULL DEFAULT 'INVITE_ONLY',
  "hostUserId" TEXT NOT NULL,
  "livekitRoomName" TEXT,
  "roomStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "allowRecording" BOOLEAN NOT NULL DEFAULT false,
  "recordingRequired" BOOLEAN NOT NULL DEFAULT false,
  "allowChat" BOOLEAN NOT NULL DEFAULT true,
  "allowWhiteboard" BOOLEAN NOT NULL DEFAULT true,
  "allowAnnotation" BOOLEAN NOT NULL DEFAULT true,
  "allowScreenShare" BOOLEAN NOT NULL DEFAULT true,
  "allowParticipantMic" BOOLEAN NOT NULL DEFAULT true,
  "allowParticipantCamera" BOOLEAN NOT NULL DEFAULT true,
  "joinBeforeMinutes" INTEGER NOT NULL DEFAULT 15,
  "lockAfterStart" BOOLEAN NOT NULL DEFAULT false,
  "roomLocked" BOOLEAN NOT NULL DEFAULT false,
  "whiteboardData" JSONB,
  "createdById" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAudience" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "type" "MeetingAudienceType" NOT NULL,
  "branchId" TEXT,
  "departmentId" TEXT,
  "teamKey" TEXT,
  "role" "Role",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingAudience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingParticipant" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "participantType" "MeetingParticipantType" NOT NULL,
  "meetingRole" "MeetingParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
  "invitationStatus" "MeetingInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "responseStatus" "MeetingResponseStatus" NOT NULL DEFAULT 'PENDING',
  "addedById" TEXT NOT NULL,
  "invitedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "declinedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  "status" "MeetingAgendaStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingAgendaItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAttachment" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "agendaItemId" TEXT,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storageKey" TEXT,
  "data" BYTEA,
  "visibility" TEXT NOT NULL DEFAULT 'PARTICIPANTS',
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAttendance" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "firstJoinedAt" TIMESTAMP(3),
  "lastLeftAt" TIMESTAMP(3),
  "totalDurationSeconds" INTEGER NOT NULL DEFAULT 0,
  "joinCount" INTEGER NOT NULL DEFAULT 0,
  "status" "MeetingAttendanceStatus" NOT NULL DEFAULT 'ABSENT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingAttendance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAttendanceSession" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "attendanceId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'LIVEKIT',
  CONSTRAINT "MeetingAttendanceSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingMinutes" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "notes" JSONB,
  "status" "MeetingMinutesStatus" NOT NULL DEFAULT 'DRAFT',
  "preparedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  "priority" "MeetingActionPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "MeetingActionStatus" NOT NULL DEFAULT 'OPEN',
  "completedAt" TIMESTAMP(3),
  "completionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingRecording" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'LIVEKIT',
  "providerRecordingId" TEXT,
  "egressId" TEXT,
  "objectKey" TEXT,
  "status" "MeetingRecordingStatus" NOT NULL DEFAULT 'STARTING',
  "startedAt" TIMESTAMP(3),
  "stoppedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER,
  "sizeBytes" BIGINT,
  "initiatedById" TEXT NOT NULL,
  "retentionUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingInvite" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" "MeetingInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingCalendarLink" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "MeetingCalendarProvider" NOT NULL DEFAULT 'INTERNAL',
  "externalEventId" TEXT,
  "syncStatus" "MeetingSyncStatus" NOT NULL DEFAULT 'PENDING',
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingCalendarLink_pkey" PRIMARY KEY ("id")
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

CREATE UNIQUE INDEX "MeetingSeries_organizationId_id_key" ON "MeetingSeries"("organizationId","id");
CREATE INDEX "MeetingSeries_organizationId_status_idx" ON "MeetingSeries"("organizationId","status");
CREATE INDEX "MeetingSeries_organizationId_branchId_departmentId_idx" ON "MeetingSeries"("organizationId","branchId","departmentId");

CREATE UNIQUE INDEX "Meeting_livekitRoomName_key" ON "Meeting"("livekitRoomName");
CREATE UNIQUE INDEX "Meeting_organizationId_id_key" ON "Meeting"("organizationId","id");
CREATE INDEX "Meeting_organizationId_startsAt_status_idx" ON "Meeting"("organizationId","startsAt","status");
CREATE INDEX "Meeting_organizationId_branchId_startsAt_idx" ON "Meeting"("organizationId","branchId","startsAt");
CREATE INDEX "Meeting_organizationId_departmentId_startsAt_idx" ON "Meeting"("organizationId","departmentId","startsAt");
CREATE INDEX "Meeting_organizationId_hostUserId_startsAt_idx" ON "Meeting"("organizationId","hostUserId","startsAt");

CREATE INDEX "MeetingAudience_organizationId_meetingId_idx" ON "MeetingAudience"("organizationId","meetingId");
CREATE INDEX "MeetingAudience_organizationId_branchId_departmentId_idx" ON "MeetingAudience"("organizationId","branchId","departmentId");

CREATE UNIQUE INDEX "MeetingParticipant_meetingId_userId_key" ON "MeetingParticipant"("meetingId","userId");
CREATE INDEX "MeetingParticipant_organizationId_userId_meetingRole_idx" ON "MeetingParticipant"("organizationId","userId","meetingRole");
CREATE INDEX "MeetingParticipant_organizationId_meetingId_responseStatus_idx" ON "MeetingParticipant"("organizationId","meetingId","responseStatus");

CREATE UNIQUE INDEX "MeetingAgendaItem_meetingId_sequence_key" ON "MeetingAgendaItem"("meetingId","sequence");
CREATE INDEX "MeetingAgendaItem_organizationId_meetingId_idx" ON "MeetingAgendaItem"("organizationId","meetingId");

CREATE INDEX "MeetingAttachment_organizationId_meetingId_idx" ON "MeetingAttachment"("organizationId","meetingId");
CREATE INDEX "MeetingAttachment_organizationId_agendaItemId_idx" ON "MeetingAttachment"("organizationId","agendaItemId");

CREATE UNIQUE INDEX "MeetingAttendance_participantId_key" ON "MeetingAttendance"("participantId");
CREATE INDEX "MeetingAttendance_organizationId_meetingId_status_idx" ON "MeetingAttendance"("organizationId","meetingId","status");
CREATE INDEX "MeetingAttendanceSession_organizationId_attendanceId_joinedAt_idx" ON "MeetingAttendanceSession"("organizationId","attendanceId","joinedAt");

CREATE UNIQUE INDEX "MeetingMinutes_meetingId_key" ON "MeetingMinutes"("meetingId");
CREATE INDEX "MeetingMinutes_organizationId_status_idx" ON "MeetingMinutes"("organizationId","status");
CREATE INDEX "MeetingDecision_organizationId_meetingId_idx" ON "MeetingDecision"("organizationId","meetingId");

CREATE INDEX "MeetingActionItem_organizationId_assigneeUserId_status_dueAt_idx" ON "MeetingActionItem"("organizationId","assigneeUserId","status","dueAt");
CREATE INDEX "MeetingActionItem_organizationId_meetingId_status_idx" ON "MeetingActionItem"("organizationId","meetingId","status");

CREATE INDEX "MeetingRecording_organizationId_meetingId_createdAt_idx" ON "MeetingRecording"("organizationId","meetingId","createdAt");
CREATE INDEX "MeetingRecording_organizationId_status_idx" ON "MeetingRecording"("organizationId","status");

CREATE INDEX "MeetingInvite_organizationId_meetingId_status_idx" ON "MeetingInvite"("organizationId","meetingId","status");
CREATE INDEX "MeetingInvite_organizationId_participantId_idx" ON "MeetingInvite"("organizationId","participantId");

CREATE UNIQUE INDEX "MeetingCalendarLink_meetingId_userId_provider_key" ON "MeetingCalendarLink"("meetingId","userId","provider");
CREATE INDEX "MeetingCalendarLink_organizationId_userId_syncStatus_idx" ON "MeetingCalendarLink"("organizationId","userId","syncStatus");

CREATE INDEX "MeetingAuditLog_organizationId_meetingId_createdAt_idx" ON "MeetingAuditLog"("organizationId","meetingId","createdAt");
CREATE INDEX "MeetingAuditLog_organizationId_actorUserId_createdAt_idx" ON "MeetingAuditLog"("organizationId","actorUserId","createdAt");

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MeetingSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingAudience" ADD CONSTRAINT "MeetingAudience_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttachment" ADD CONSTRAINT "MeetingAttachment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendance" ADD CONSTRAINT "MeetingAttendance_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MeetingParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendanceSession" ADD CONSTRAINT "MeetingAttendanceSession_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "MeetingAttendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "MeetingAgendaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "MeetingDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingInvite" ADD CONSTRAINT "MeetingInvite_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingInvite" ADD CONSTRAINT "MeetingInvite_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MeetingParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingCalendarLink" ADD CONSTRAINT "MeetingCalendarLink_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAuditLog" ADD CONSTRAINT "MeetingAuditLog_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve existing tenant access while exposing explicit commercial controls.
-- Future plan packaging can disable these keys per plan from the SaaS control center.
UPDATE "SaaSPlan"
SET "entitlements" = COALESCE("entitlements", '{}'::jsonb)
  || '{"meetings": true, "meetings_recording": true}'::jsonb;
