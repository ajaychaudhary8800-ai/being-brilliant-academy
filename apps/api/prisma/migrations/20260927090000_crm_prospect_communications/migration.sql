CREATE TABLE "EnquiryCommunication" (
    "organizationId" TEXT NOT NULL DEFAULT 'org_default',
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "createdById" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryCommunication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EnquiryCommunication_enquiryId_createdAt_idx"
ON "EnquiryCommunication"("enquiryId", "createdAt");

CREATE INDEX "EnquiryCommunication_organizationId_idx"
ON "EnquiryCommunication"("organizationId");

CREATE INDEX "EnquiryCommunication_status_createdAt_idx"
ON "EnquiryCommunication"("status", "createdAt");

ALTER TABLE "EnquiryCommunication"
ADD CONSTRAINT "EnquiryCommunication_enquiryId_fkey"
FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id")
ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "EnquiryCommunication"
ADD CONSTRAINT "EnquiryCommunication_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
