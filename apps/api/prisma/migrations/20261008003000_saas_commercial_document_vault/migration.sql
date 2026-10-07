CREATE TABLE "SaaSCommercialDocument" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "organizationId" TEXT,
  "documentType" TEXT NOT NULL,
  "documentReference" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3),
  "notes" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "fileSize" INTEGER NOT NULL,
  "fileData" BYTEA NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "verificationNotes" TEXT,
  "uploadedById" TEXT NOT NULL,
  "verifiedById" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "archivedById" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SaaSCommercialDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaaSCommercialDocument_leadId_documentType_createdAt_idx"
ON "SaaSCommercialDocument"("leadId", "documentType", "createdAt");

CREATE INDEX "SaaSCommercialDocument_organizationId_createdAt_idx"
ON "SaaSCommercialDocument"("organizationId", "createdAt");

CREATE INDEX "SaaSCommercialDocument_verificationStatus_createdAt_idx"
ON "SaaSCommercialDocument"("verificationStatus", "createdAt");

CREATE INDEX "SaaSCommercialDocument_contentSha256_idx"
ON "SaaSCommercialDocument"("contentSha256");

ALTER TABLE "SaaSCommercialDocument"
ADD CONSTRAINT "SaaSCommercialDocument_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "SaaSSalesLead"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
