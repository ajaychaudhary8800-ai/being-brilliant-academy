import { OrganizationSubscriptionStatus, Prisma, SaaSPaymentStatus } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";

type JsonRecord = Record<string, unknown>;
type CapturedPayment = { id: string; order_id: string; amount: number; currency: string };

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};

const booleanMap = (value: unknown): Record<string, boolean> =>
  Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));

const limitMap = (value: unknown): Record<string, number | null> =>
  Object.fromEntries(
    Object.entries(record(value)).flatMap(([key, raw]) =>
      raw === null ? [[key, null] as const] : typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? [[key, Math.floor(raw)] as const] : [],
    ),
  );

async function commercialPolicySnapshot(organizationId: string) {
  const organization = await systemPrisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      settings: true,
      trialEndsAt: true,
      subscriptionEndsAt: true,
      saasSubscription: { include: { plan: true } },
    },
  });
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");

  const { saasSubscription: subscription, ...organizationRecord } = organization;
  const fallbackPlan = subscription ? null : await systemPrisma.saaSPlan.findUnique({ where: { code: organization.subscriptionPlan } });
  const plan = subscription?.plan ?? fallbackPlan;
  const commercialSettings = record(record(organization.settings).commercialEntitlements);
  const enforcementEnabled = commercialSettings.enforce === true;
  const entitlements = booleanMap(plan?.entitlements);
  const limits = limitMap(plan?.limits);

  return {
    organization: organizationRecord,
    subscription,
    plan: plan ? {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      currency: plan.currency,
      monthlyPricePaise: plan.monthlyPricePaise,
      annualPricePaise: plan.annualPricePaise,
      taxRateBps: plan.taxRateBps,
      entitlements,
      limits,
    } : null,
    enforcementEnabled,
  };
}

export async function commercialAccessSnapshot(organizationId: string) {
  const policy = await commercialPolicySnapshot(organizationId);
  const [branches, users, students] = await Promise.all([
    systemPrisma.branch.count({ where: { organizationId, isActive: true } }),
    systemPrisma.user.count({ where: { organizationId, isActive: true } }),
    systemPrisma.studentProfile.count({ where: { organizationId } }),
  ]);
  return { ...policy, usage: { branches, users, students } };
}

export async function assertFeatureEntitled(organizationId: string, feature: string) {
  const policy = await commercialPolicySnapshot(organizationId);
  if (!policy.enforcementEnabled) return policy;
  if (policy.plan?.entitlements["*"] === true || policy.plan?.entitlements[feature] === true) return policy;
  throw new AppError(403, "PLAN_FEATURE_REQUIRED", `Your subscription plan does not include ${feature}`);
}

export async function assertWithinCommercialLimit(
  organizationId: string,
  limitKey: "branches" | "users" | "students",
  increment = 1,
) {
  const snapshot = await commercialAccessSnapshot(organizationId);
  if (!snapshot.enforcementEnabled) return snapshot;
  const limit = snapshot.plan?.limits[limitKey];
  if (limit === null || limit === undefined) return snapshot;
  if (snapshot.usage[limitKey] + increment <= limit) return snapshot;
  throw new AppError(409, "PLAN_LIMIT_REACHED", `Your subscription plan limit for ${limitKey} has been reached`);
}

export async function captureSaaSRazorpayPayment(payment: CapturedPayment, event: unknown) {
  const existingInvoice = await systemPrisma.saaSInvoice.findUnique({
    where: { providerOrderId: payment.order_id },
    select: { id: true },
  });
  if (!existingInvoice) return false;

  const eventKey = `payment.captured:${payment.id}`;
  try {
    await systemPrisma.$transaction(async tx => {
      const invoice = await tx.saaSInvoice.findUnique({
        where: { providerOrderId: payment.order_id },
        include: { subscription: { include: { plan: true } } },
      });
      if (!invoice) return;
      if (invoice.status === "PAID") return;
      if (payment.amount !== invoice.totalPaise || payment.currency.toUpperCase() !== invoice.currency.toUpperCase()) {
        throw new AppError(422, "PAYMENT_MISMATCH", "Captured SaaS payment does not match the subscription invoice");
      }

      const priorEvent = await tx.saaSWebhookEvent.findUnique({
        where: { provider_eventKey: { provider: "RAZORPAY", eventKey } },
      });
      if (priorEvent?.processedAt) return;

      await tx.saaSWebhookEvent.upsert({
        where: { provider_eventKey: { provider: "RAZORPAY", eventKey } },
        create: {
          provider: "RAZORPAY",
          eventKey,
          eventType: "payment.captured",
          payload: event as Prisma.InputJsonValue,
        },
        update: { payload: event as Prisma.InputJsonValue },
      });

      const now = new Date();
      await tx.saaSPayment.upsert({
        where: { providerPaymentId: payment.id },
        create: {
          organizationId: invoice.organizationId,
          invoiceId: invoice.id,
          provider: "RAZORPAY",
          providerPaymentId: payment.id,
          amountPaise: payment.amount,
          currency: payment.currency.toUpperCase(),
          status: SaaSPaymentStatus.CAPTURED,
          capturedAt: now,
          raw: event as Prisma.InputJsonValue,
        },
        update: {
          status: SaaSPaymentStatus.CAPTURED,
          capturedAt: now,
          raw: event as Prisma.InputJsonValue,
        },
      });
      await tx.saaSInvoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidAt: now },
      });
      await tx.saaSSubscription.update({
        where: { id: invoice.subscriptionId },
        data: {
          status: OrganizationSubscriptionStatus.ACTIVE,
          currentPeriodStart: invoice.periodStart,
          currentPeriodEnd: invoice.periodEnd,
          provider: "RAZORPAY",
        },
      });
      await tx.organization.update({
        where: { id: invoice.organizationId },
        data: {
          subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
          subscriptionPlan: invoice.subscription.plan.code,
          trialEndsAt: null,
          subscriptionEndsAt: invoice.periodEnd,
          isActive: true,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: invoice.organizationId,
          action: "SAAS_SUBSCRIPTION_PAYMENT_CAPTURED",
          entity: "SaaSInvoice",
          entityId: invoice.id,
          metadata: {
            provider: "RAZORPAY",
            providerPaymentId: payment.id,
            amountPaise: payment.amount,
            planCode: invoice.subscription.plan.code,
            periodEnd: invoice.periodEnd.toISOString(),
          },
        },
      });
      await tx.saaSWebhookEvent.update({
        where: { provider_eventKey: { provider: "RAZORPAY", eventKey } },
        data: { processedAt: now },
      });
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const captured = await systemPrisma.saaSPayment.findUnique({ where: { providerPaymentId: payment.id } });
      if (captured?.status === SaaSPaymentStatus.CAPTURED) return true;
    }
    throw error;
  }
}
