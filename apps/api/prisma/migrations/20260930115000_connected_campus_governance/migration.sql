DO $$
BEGIN
  CREATE TYPE "PrivacySubjectType" AS ENUM ('STUDENT','GUARDIAN','EMPLOYEE','VISITOR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "PrivacyPurpose" AS ENUM ('ACADEMIC','ATTENDANCE','TRANSPORT','SAFETY','VIDEO_SECURITY','ASSESSMENT_AI','COMMUNICATION','ANALYTICS','DEVICE_INTEGRATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "PrivacyConsentStatus" AS ENUM ('GRANTED','DENIED','WITHDRAWN','NOT_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "PrivacyRetentionAction" AS ENUM ('DELETE','ANONYMIZE','ARCHIVE','REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS','EXPORT','RECTIFY','DELETE','RESTRICT_PROCESSING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('REQUESTED','VERIFIED','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "CapabilityCertificationKind" AS ENUM ('HARDWARE_ADAPTER','HARDWARE_DEVICE','AI_GRADING','SECURITY_PRIVACY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "CapabilityCertificationStatus" AS ENUM ('DRAFT','IN_REVIEW','PASSED','FAILED','EXPIRED','REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "CertificationEnvironment" AS ENUM ('STAGING','PRODUCTION_LIKE','REAL_DEVICE','BENCHMARK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PrivacyRetentionPolicy" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "branchId" TEXT,
  "purpose" "PrivacyPurpose" NOT NULL,
  "subjectType" "PrivacySubjectType",
  "retentionDays" INTEGER NOT NULL,
  "action" "PrivacyRetentionAction" NOT NULL,
  "legalBasis" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrivacyRetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PrivacyConsentRecord" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "subjectType" "PrivacySubjectType" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "guardianId" TEXT,
  "purpose" "PrivacyPurpose" NOT NULL,
  "status" "PrivacyConsentStatus" NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "evidence" JSONB,
  "grantedAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "recordedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrivacyConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DataSubjectRequest" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "subjectType" "PrivacySubjectType" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "requestedById" TEXT,
  "type" "DataSubjectRequestType" NOT NULL,
  "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "scope" JSONB,
  "reason" TEXT,
  "verifiedById" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "assignedToId" TEXT,
  "completedById" TEXT,
  "completedAt" TIMESTAMP(3),
  "resultRef" TEXT,
  "rejectionReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CapabilityCertification" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "capabilityKey" TEXT NOT NULL,
  "kind" "CapabilityCertificationKind" NOT NULL,
  "status" "CapabilityCertificationStatus" NOT NULL DEFAULT 'DRAFT',
  "environment" "CertificationEnvironment" NOT NULL,
  "adapterKey" TEXT,
  "deviceId" TEXT,
  "benchmarkRunId" TEXT,
  "vendor" TEXT,
  "hardwareModel" TEXT,
  "firmwareVersion" TEXT,
  "protocolVersion" TEXT,
  "evidence" JSONB NOT NULL,
  "testedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "testedById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CapabilityCertification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PrivacyRetentionPolicy_scope_version_key"
  ON "PrivacyRetentionPolicy"("organizationId","branchId","purpose","subjectType","policyVersion");
CREATE INDEX IF NOT EXISTS "PrivacyRetentionPolicy_organizationId_purpose_isActive_idx"
  ON "PrivacyRetentionPolicy"("organizationId","purpose","isActive");
CREATE INDEX IF NOT EXISTS "PrivacyRetentionPolicy_organizationId_branchId_isActive_idx"
  ON "PrivacyRetentionPolicy"("organizationId","branchId","isActive");

CREATE INDEX IF NOT EXISTS "PrivacyConsentRecord_subject_purpose_idx"
  ON "PrivacyConsentRecord"("organizationId","subjectType","subjectId","purpose","createdAt");
CREATE INDEX IF NOT EXISTS "PrivacyConsentRecord_guardian_purpose_idx"
  ON "PrivacyConsentRecord"("organizationId","guardianId","purpose","createdAt");
CREATE INDEX IF NOT EXISTS "PrivacyConsentRecord_status_expiry_idx"
  ON "PrivacyConsentRecord"("organizationId","status","expiresAt");

CREATE INDEX IF NOT EXISTS "DataSubjectRequest_status_createdAt_idx"
  ON "DataSubjectRequest"("organizationId","status","createdAt");
CREATE INDEX IF NOT EXISTS "DataSubjectRequest_subject_createdAt_idx"
  ON "DataSubjectRequest"("organizationId","subjectType","subjectId","createdAt");
CREATE INDEX IF NOT EXISTS "DataSubjectRequest_requester_createdAt_idx"
  ON "DataSubjectRequest"("organizationId","requestedById","createdAt");

CREATE INDEX IF NOT EXISTS "CapabilityCertification_capability_environment_status_idx"
  ON "CapabilityCertification"("organizationId","capabilityKey","environment","status");
CREATE INDEX IF NOT EXISTS "CapabilityCertification_kind_status_expiry_idx"
  ON "CapabilityCertification"("organizationId","kind","status","expiresAt");
CREATE INDEX IF NOT EXISTS "CapabilityCertification_device_status_idx"
  ON "CapabilityCertification"("organizationId","deviceId","status");
CREATE INDEX IF NOT EXISTS "CapabilityCertification_benchmark_status_idx"
  ON "CapabilityCertification"("organizationId","benchmarkRunId","status");
