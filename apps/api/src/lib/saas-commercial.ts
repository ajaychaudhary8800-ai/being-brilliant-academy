import { OrganizationSubscriptionStatus, Prisma, SaaSPaymentStatus } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";

type JsonRecord = Record<string, unknown>;
type CapturedPayment = { id: string; order_id: string; amount: number; currency: string };

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};

const booleanMap = (value: unknown): Record<string, boolean> =>
  Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));

const limitMap = (value: unknown): Record<string, number | null> => {
  const limits: Record<string, number | null> = {};
  for (const [key, raw] of Object.entries(record(value))) {
    if (raw === null) limits[key] = null;
    else if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) limits[key] = Math.floor(raw);
  }
  return limits;
};

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
  const fallbackPlan = subscription || !organization.subscriptionPlan ? null : await systemPrisma.saaSPlan.findUnique({ where: { code: organization.subscriptionPlan } });
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

export async function commercialEntitlementSnapshot(organizationId: string) {
  const policy = await commercialPolicySnapshot(organizationId);
  return {
    enforcementEnabled: policy.enforcementEnabled,
    planCode: policy.plan?.code ?? policy.organization.subscriptionPlan,
    entitlements: policy.plan?.entitlements ?? {},
  };
}

export async function commercialAccessSnapshot(organizationId: string) {
  const policy = await commercialPolicySnapshot(organizationId);
  const [branches, users, students] = await Promise.all([
    systemPrisma.branch.count({ where: { organizationId, isActive: true } }),
    systemPrisma.user.count({ where: { organizationId, isActive: true } }),
    systemPrisma.studentProfile.count({ where: { organizationId, status: "ACTIVE" } }),
  ]);
  return { ...policy, usage: { branches, users, students } };
}

export async function assertFeatureEntitled(organizationId: string, feature: string) {
  const policy = await commercialPolicySnapshot(organizationId);
  if (!policy.enforcementEnabled) return policy;
  if (policy.plan?.entitlements["*"] === true || policy.plan?.entitlements[feature] === true) return policy;
  throw new AppError(403, "PLAN_FEATURE_REQUIRED", `Your subscription plan does not include ${feature}`);
}

export async function assertCommercialPlanFitsUsage(organizationId: string, limitsValue: unknown) {
  const limits = limitMap(limitsValue);
  const [branches, users, students] = await Promise.all([
    systemPrisma.branch.count({ where: { organizationId, isActive: true } }),
    systemPrisma.user.count({ where: { organizationId, isActive: true } }),
    systemPrisma.studentProfile.count({ where: { organizationId, status: "ACTIVE" } }),
  ]);
  const usage = { branches, users, students };
  for (const key of ["branches", "users", "students"] as const) {
    const limit = limits[key];
    if (limit !== null && limit !== undefined && usage[key] > limit) {
      throw new AppError(409, "PLAN_LIMIT_BELOW_USAGE", `The selected plan allows ${limit} ${key}, but this organization currently uses ${usage[key]}`);
    }
  }
  return usage;
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
        include: { subscription: true, plan: true },
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
          planId: invoice.planId,
          status: OrganizationSubscriptionStatus.ACTIVE,
          currentPeriodStart: invoice.periodStart,
          currentPeriodEnd: invoice.periodEnd,
          cancelAtPeriodEnd: false,
          provider: "RAZORPAY",
        },
      });
      await tx.organization.update({
        where: { id: invoice.organizationId },
        data: {
          subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
          subscriptionPlan: invoice.plan.code,
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
            planCode: invoice.plan.code,
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


export async function reconcileSaaSLifecycle(now = new Date()) {
  const overdue = await systemPrisma.saaSInvoice.updateMany({
    where: { status: "OPEN", dueAt: { lt: now } },
    data: { status: "OVERDUE" },
  });

  const expiring = await systemPrisma.saaSSubscription.findMany({
    where: {
      status: OrganizationSubscriptionStatus.ACTIVE,
      currentPeriodEnd: { lte: now },
    },
    select: { id: true, organizationId: true, cancelAtPeriodEnd: true },
    take: 500,
  });

  let pastDue = 0, cancelled = 0;
  for (const subscription of expiring) {
    const nextStatus = subscription.cancelAtPeriodEnd
      ? OrganizationSubscriptionStatus.CANCELLED
      : OrganizationSubscriptionStatus.PAST_DUE;
    const changed = await systemPrisma.$transaction(async tx => {
      const updated = await tx.saaSSubscription.updateMany({
        where: { id: subscription.id, status: OrganizationSubscriptionStatus.ACTIVE, currentPeriodEnd: { lte: now } },
        data: { status: nextStatus },
      });
      if (!updated.count) return false;
      await tx.organization.update({
        where: { id: subscription.organizationId },
        data: { subscriptionStatus: nextStatus },
      });
      await tx.auditLog.create({
        data: {
          organizationId: subscription.organizationId,
          action: nextStatus === OrganizationSubscriptionStatus.CANCELLED ? "SAAS_SUBSCRIPTION_CANCELLED" : "SAAS_SUBSCRIPTION_PAST_DUE",
          entity: "SaaSSubscription",
          entityId: subscription.id,
          metadata: { reconciledAt: now.toISOString() },
        },
      });
      return true;
    });
    if (changed && nextStatus === OrganizationSubscriptionStatus.CANCELLED) cancelled++;
    else if (changed) pastDue++;
  }

  const expiredTrials = await systemPrisma.organization.findMany({
    where: {
      subscriptionStatus: OrganizationSubscriptionStatus.TRIAL,
      trialEndsAt: { lte: now },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true },
    take: 500,
  });
  let expiredTrialsPastDue = 0;
  for (const organization of expiredTrials) {
    const changed = await systemPrisma.$transaction(async tx => {
      const updated = await tx.organization.updateMany({
        where: { id: organization.id, subscriptionStatus: OrganizationSubscriptionStatus.TRIAL, trialEndsAt: { lte: now } },
        data: { subscriptionStatus: OrganizationSubscriptionStatus.PAST_DUE },
      });
      if (!updated.count) return false;
      await tx.saaSSubscription.updateMany({
        where: { organizationId: organization.id, status: OrganizationSubscriptionStatus.TRIAL },
        data: { status: OrganizationSubscriptionStatus.PAST_DUE },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          action: "SAAS_TRIAL_EXPIRED",
          entity: "Organization",
          entityId: organization.id,
          metadata: { reconciledAt: now.toISOString() },
        },
      });
      return true;
    });
    if (changed) expiredTrialsPastDue++;
  }

  return { overdueInvoices: overdue.count, pastDue, cancelled, expiredTrialsPastDue };
}
