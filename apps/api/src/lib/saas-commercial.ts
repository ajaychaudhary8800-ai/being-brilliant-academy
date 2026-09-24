import { OrganizationSubscriptionStatus, Prisma, Role, SaaSPaymentStatus } from "@prisma/client";
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
      trialDays: plan.trialDays,
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

export async function commercialFeatureEnabled(organizationId: string, feature: string) {
  const policy = await commercialPolicySnapshot(organizationId);
  return !policy.enforcementEnabled || policy.plan?.entitlements["*"] === true || policy.plan?.entitlements[feature] === true;
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


async function queueSaaSBillingNotice(input: {
  organizationId: string;
  sourceEntityId: string;
  title: string;
  body: string;
  priority?: "NORMAL" | "HIGH" | "URGENT";
}) {
  return systemPrisma.$transaction(async tx => {
    const lockKey = `saas-billing-notice:${input.organizationId}:${input.sourceEntityId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const existing = await tx.notification.findFirst({
      where: {
        organizationId: input.organizationId,
        sourceModule: "SAAS_BILLING",
        sourceEntityId: input.sourceEntityId,
      },
      select: { id: true },
    });
    if (existing) return 0;

    const admins = await tx.user.findMany({
      where: { organizationId: input.organizationId, role: Role.SUPER_ADMIN, isActive: true },
      select: { id: true },
    });
    for (const admin of admins) {
      const notification = await tx.notification.create({
        data: {
          organizationId: input.organizationId,
          userId: admin.id,
          title: input.title,
          body: input.body,
          category: "BILLING",
          sourceModule: "SAAS_BILLING",
          sourceEntityId: input.sourceEntityId,
          actionUrl: "/admin/subscription",
          priority: input.priority ?? "HIGH",
          channels: ["IN_APP", "EMAIL"],
        },
      });
      await tx.notificationDelivery.create({
        data: {
          organizationId: input.organizationId,
          notificationId: notification.id,
          channel: "EMAIL",
          status: "QUEUED",
        },
      });
    }
    return admins.length;
  });
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


  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const oneDay = 24 * 60 * 60 * 1000;
  let renewalRemindersQueued = 0;

  const upcoming = await systemPrisma.saaSSubscription.findMany({
    where: {
      status: OrganizationSubscriptionStatus.ACTIVE,
      currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + sevenDays) },
    },
    select: {
      id: true,
      organizationId: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      plan: { select: { name: true } },
    },
    take: 500,
  });
  for (const subscription of upcoming) {
    if (!subscription.currentPeriodEnd) continue;
    const remaining = subscription.currentPeriodEnd.getTime() - now.getTime();
    const window = remaining <= oneDay ? "1D" : "7D";
    const ending = subscription.currentPeriodEnd.toISOString().slice(0, 10);
    renewalRemindersQueued += await queueSaaSBillingNotice({
      organizationId: subscription.organizationId,
      sourceEntityId: `${subscription.id}:renewal:${window}:${subscription.currentPeriodEnd.toISOString()}`,
      title: subscription.cancelAtPeriodEnd ? "Subscription scheduled to end" : "Subscription renewal due soon",
      body: subscription.cancelAtPeriodEnd
        ? `Your ${subscription.plan.name} subscription is scheduled to end on ${ending}. You can keep the subscription active from Subscription & Billing before the period ends.`
        : `Your ${subscription.plan.name} subscription period ends on ${ending}. Open Subscription & Billing to review the plan and complete renewal.`,
      priority: remaining <= oneDay ? "URGENT" : "HIGH",
    });
  }

  const pastDueSubscriptions = await systemPrisma.saaSSubscription.findMany({
    where: {
      status: OrganizationSubscriptionStatus.PAST_DUE,
      currentPeriodEnd: { lte: now },
    },
    select: {
      id: true,
      organizationId: true,
      currentPeriodEnd: true,
      plan: { select: { name: true } },
    },
    take: 500,
  });
  for (const subscription of pastDueSubscriptions) {
    const periodEnd = subscription.currentPeriodEnd?.toISOString() ?? "unknown";
    renewalRemindersQueued += await queueSaaSBillingNotice({
      organizationId: subscription.organizationId,
      sourceEntityId: `${subscription.id}:past-due:${periodEnd}`,
      title: "Subscription payment required",
      body: `Your ${subscription.plan.name} subscription has expired. Billing-only recovery access remains available so an organization Super Admin can renew the subscription.`,
      priority: "URGENT",
    });
  }

  const expiredTrialOrganizations = await systemPrisma.organization.findMany({
    where: {
      subscriptionStatus: OrganizationSubscriptionStatus.PAST_DUE,
      trialEndsAt: { lte: now },
      subscriptionEndsAt: null,
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, trialEndsAt: true },
    take: 500,
  });
  for (const organization of expiredTrialOrganizations) {
    if (!organization.trialEndsAt) continue;
    renewalRemindersQueued += await queueSaaSBillingNotice({
      organizationId: organization.id,
      sourceEntityId: `trial-expired:${organization.id}:${organization.trialEndsAt.toISOString()}`,
      title: "Trial expired",
      body: "Your SaaS trial has ended. Billing-only recovery access remains available so an organization Super Admin can choose a plan and activate the subscription.",
      priority: "URGENT",
    });
  }

  return { overdueInvoices: overdue.count, pastDue, cancelled, expiredTrialsPastDue, renewalRemindersQueued };
}
