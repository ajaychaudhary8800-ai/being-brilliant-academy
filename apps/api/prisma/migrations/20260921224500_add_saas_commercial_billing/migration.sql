-- Commercial SaaS billing and entitlement control plane.
-- Existing Organization.subscription* fields remain the runtime compatibility contract.
-- New plans default to wildcard access; explicit entitlement enforcement is opt-in per organization.

CREATE TYPE "SaaSBillingCycle" AS ENUM ('MONTHLY', 'ANNUAL', 'CUSTOM');
CREATE TYPE "SaaSInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'OVERDUE');
CREATE TYPE "SaaSPaymentStatus" AS ENUM ('CREATED', 'CAPTURED', 'FAILED', 'REFUNDED');

CREATE TABLE "SaaSPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPricePaise" INTEGER NOT NULL DEFAULT 0,
    "annualPricePaise" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "entitlements" JSONB NOT NULL DEFAULT '{"*": true}',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SaaSPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaaSSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "OrganizationSubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "billingCycle" "SaaSBillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SaaSSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaaSInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "SaaSInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "provider" TEXT,
    "providerOrderId" TEXT,
    "checkoutKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SaaSInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaaSPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "SaaSPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "raw" JSONB,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaaSPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaaSWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaaSWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaaSPlan_code_key" ON "SaaSPlan"("code");
CREATE INDEX "SaaSPlan_isActive_code_idx" ON "SaaSPlan"("isActive", "code");

CREATE UNIQUE INDEX "SaaSSubscription_organizationId_key" ON "SaaSSubscription"("organizationId");
CREATE UNIQUE INDEX "SaaSSubscription_providerSubscriptionId_key" ON "SaaSSubscription"("providerSubscriptionId");
CREATE INDEX "SaaSSubscription_planId_status_idx" ON "SaaSSubscription"("planId", "status");
CREATE INDEX "SaaSSubscription_currentPeriodEnd_idx" ON "SaaSSubscription"("currentPeriodEnd");

CREATE UNIQUE INDEX "SaaSInvoice_invoiceNo_key" ON "SaaSInvoice"("invoiceNo");
CREATE UNIQUE INDEX "SaaSInvoice_providerOrderId_key" ON "SaaSInvoice"("providerOrderId");
CREATE UNIQUE INDEX "SaaSInvoice_checkoutKey_key" ON "SaaSInvoice"("checkoutKey");
CREATE INDEX "SaaSInvoice_organizationId_status_createdAt_idx" ON "SaaSInvoice"("organizationId", "status", "createdAt");
CREATE INDEX "SaaSInvoice_subscriptionId_periodEnd_idx" ON "SaaSInvoice"("subscriptionId", "periodEnd");

CREATE UNIQUE INDEX "SaaSPayment_providerPaymentId_key" ON "SaaSPayment"("providerPaymentId");
CREATE INDEX "SaaSPayment_organizationId_createdAt_idx" ON "SaaSPayment"("organizationId", "createdAt");
CREATE INDEX "SaaSPayment_invoiceId_status_idx" ON "SaaSPayment"("invoiceId", "status");

CREATE UNIQUE INDEX "SaaSWebhookEvent_provider_eventKey_key" ON "SaaSWebhookEvent"("provider", "eventKey");
CREATE INDEX "SaaSWebhookEvent_provider_createdAt_idx" ON "SaaSWebhookEvent"("provider", "createdAt");

ALTER TABLE "SaaSSubscription"
  ADD CONSTRAINT "SaaSSubscription_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaaSSubscription"
  ADD CONSTRAINT "SaaSSubscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "SaaSPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaaSInvoice"
  ADD CONSTRAINT "SaaSInvoice_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaaSInvoice"
  ADD CONSTRAINT "SaaSInvoice_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "SaaSSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaaSPayment"
  ADD CONSTRAINT "SaaSPayment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaaSPayment"
  ADD CONSTRAINT "SaaSPayment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "SaaSInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "SaaSPlan" (
  "id", "code", "name", "description", "monthlyPricePaise", "annualPricePaise",
  "currency", "taxRateBps", "entitlements", "limits", "isActive", "updatedAt"
) VALUES
  ('saas_plan_standard', 'STANDARD', 'Standard', 'Compatibility-safe standard SaaS plan. Configure pricing and limits before enforcing entitlements.', 0, 0, 'INR', 0, '{"*": true}', '{}', true, CURRENT_TIMESTAMP),
  ('saas_plan_enterprise', 'ENTERPRISE', 'Enterprise', 'Compatibility-safe enterprise SaaS plan with unrestricted feature access by default.', 0, 0, 'INR', '{"*": true}', '{}', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
