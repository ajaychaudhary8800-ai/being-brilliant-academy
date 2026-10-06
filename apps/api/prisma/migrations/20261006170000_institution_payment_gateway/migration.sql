-- Dual payment architecture:
-- 1) institutions pay platform SaaS subscription through the platform gateway;
-- 2) parents/students pay school fees through the institution's own gateway credentials.

CREATE TYPE "PaymentGatewayMode" AS ENUM ('TEST', 'LIVE');
CREATE TYPE "InstitutionPaymentOrderStatus" AS ENUM ('CREATED', 'CAPTURED', 'FAILED', 'REVIEW_REQUIRED', 'REFUNDED');

CREATE TABLE "InstitutionPaymentGateway" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "mode" "PaymentGatewayMode" NOT NULL DEFAULT 'TEST',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "keyId" TEXT NOT NULL,
    "keySecretEncrypted" TEXT NOT NULL,
    "webhookSecretEncrypted" TEXT NOT NULL,
    "allowPartialPayments" BOOLEAN NOT NULL DEFAULT false,
    "paymentMethods" JSONB NOT NULL DEFAULT '[]',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstitutionPaymentGateway_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstitutionPaymentOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "feeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "InstitutionPaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
    "feePaymentId" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "raw" JSONB,
    "capturedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstitutionPaymentOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstitutionPaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstitutionPaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstitutionPaymentGateway_organizationId_key" ON "InstitutionPaymentGateway"("organizationId");
CREATE INDEX "InstitutionPaymentGateway_provider_isEnabled_idx" ON "InstitutionPaymentGateway"("provider", "isEnabled");

CREATE UNIQUE INDEX "InstitutionPaymentOrder_providerOrderId_key" ON "InstitutionPaymentOrder"("providerOrderId");
CREATE UNIQUE INDEX "InstitutionPaymentOrder_providerPaymentId_key" ON "InstitutionPaymentOrder"("providerPaymentId");
CREATE UNIQUE INDEX "InstitutionPaymentOrder_idempotencyKey_key" ON "InstitutionPaymentOrder"("idempotencyKey");
CREATE UNIQUE INDEX "InstitutionPaymentOrder_feePaymentId_key" ON "InstitutionPaymentOrder"("feePaymentId");
CREATE INDEX "InstitutionPaymentOrder_organizationId_status_createdAt_idx" ON "InstitutionPaymentOrder"("organizationId", "status", "createdAt");
CREATE INDEX "InstitutionPaymentOrder_gatewayId_status_createdAt_idx" ON "InstitutionPaymentOrder"("gatewayId", "status", "createdAt");
CREATE INDEX "InstitutionPaymentOrder_feeId_createdAt_idx" ON "InstitutionPaymentOrder"("feeId", "createdAt");
CREATE INDEX "InstitutionPaymentOrder_studentId_createdAt_idx" ON "InstitutionPaymentOrder"("studentId", "createdAt");

CREATE UNIQUE INDEX "InstitutionPaymentWebhookEvent_gatewayId_eventKey_key" ON "InstitutionPaymentWebhookEvent"("gatewayId", "eventKey");
CREATE INDEX "InstitutionPaymentWebhookEvent_organizationId_createdAt_idx" ON "InstitutionPaymentWebhookEvent"("organizationId", "createdAt");
CREATE INDEX "InstitutionPaymentWebhookEvent_gatewayId_eventType_createdAt_idx" ON "InstitutionPaymentWebhookEvent"("gatewayId", "eventType", "createdAt");

ALTER TABLE "InstitutionPaymentGateway"
  ADD CONSTRAINT "InstitutionPaymentGateway_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstitutionPaymentOrder"
  ADD CONSTRAINT "InstitutionPaymentOrder_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstitutionPaymentOrder"
  ADD CONSTRAINT "InstitutionPaymentOrder_gatewayId_fkey"
  FOREIGN KEY ("gatewayId") REFERENCES "InstitutionPaymentGateway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstitutionPaymentOrder"
  ADD CONSTRAINT "InstitutionPaymentOrder_feeId_fkey"
  FOREIGN KEY ("feeId") REFERENCES "Fee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstitutionPaymentOrder"
  ADD CONSTRAINT "InstitutionPaymentOrder_feePaymentId_fkey"
  FOREIGN KEY ("feePaymentId") REFERENCES "FeePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InstitutionPaymentWebhookEvent"
  ADD CONSTRAINT "InstitutionPaymentWebhookEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstitutionPaymentWebhookEvent"
  ADD CONSTRAINT "InstitutionPaymentWebhookEvent_gatewayId_fkey"
  FOREIGN KEY ("gatewayId") REFERENCES "InstitutionPaymentGateway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
