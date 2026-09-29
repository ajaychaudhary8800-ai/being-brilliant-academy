-- Add meeting-native collaboration persistence.
ALTER TABLE "Meeting" ADD COLUMN "whiteboardData" JSONB;

CREATE TABLE "MeetingInteraction" (
  "organizationId" TEXT NOT NULL DEFAULT 'org_default',
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "content" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeetingInteraction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeetingInteraction_organizationId_meetingId_createdAt_idx" ON "MeetingInteraction"("organizationId","meetingId","createdAt");
CREATE INDEX "MeetingInteraction_organizationId_userId_createdAt_idx" ON "MeetingInteraction"("organizationId","userId","createdAt");

ALTER TABLE "MeetingInteraction"
  ADD CONSTRAINT "MeetingInteraction_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
