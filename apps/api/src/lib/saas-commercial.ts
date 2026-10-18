import { OrganizationSubscriptionStatus, Prisma, Role, SaaSPaymentStatus } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { readSchoolOSFeatureOverrides, schoolOSFeatureAccess, schoolOSEffectiveOverrideLists } from "./schoolos-feature-policy.js";
import { validateSchoolOSAddonCheckout, type SchoolOSApprovedAddonLine } from "./schoolos-addon-checkout-policy.js";
import { applySchoolOSPaidAddonSettlement } from "./schoolos-addon-settlement.js";

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
  const now = new Date();
  // Add-ons are immutable payment-derived licenses, not writable tenant settings.
  // Subscription cancellation/expiry and invoice reversals immediately revoke them.
  const paidAddons = organization.subscriptionStatus === OrganizationSubscriptionStatus.ACTIVE &&
    organization.subscriptionEndsAt && organization.subscriptionEndsAt.getTime() > now.getTime()
    ? await systemPrisma.schoolOSAddonLicense.findMany({
        where: { organizationId, periodStart: { lte: now }, periodEnd: { gt: now },
          invoice: { status: "PAID", organizationId, OR: [
            { schoolOSPaymentRiskHold: { is: null } },
            { schoolOSPaymentRiskHold: { is: { status: "RESOLVED" } } },
          ] } },
        select: { category: true, code: true, units: true },
      })
    : [];
  for (const license of paidAddons) {
    if (license.category === "MODULE") entitlements[license.code] = true;
    if (license.category === "CAPACITY" && ["students","users","branches"].includes(license.code)) {
      const base = limits[license.code];
      if (base !== null && base !== undefined) {
        const increased = base + license.units;
        if (!Number.isSafeInteger(increased)) throw new AppError(409, "SCHOOLOS_LIMIT_OVERFLOW", "Purchased capacity exceeds safe limit");
        limits[license.code] = increased;
      }
    }
  }
  const featureOverrides = readSchoolOSFeatureOverrides(commercialSettings.featureOverrides);

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
    paidAddons,
    featureOverrides,
  };
}

export async function commercialEntitlementSnapshot(organizationId: string) {
  const policy = await commercialPolicySnapshot(organizationId);
  return {
    enforcementEnabled: policy.enforcementEnabled,
    planCode: policy.plan?.code ?? policy.organization.subscriptionPlan,
    entitlements: policy.plan?.entitlements ?? {},
    ...schoolOSEffectiveOverrideLists(policy.featureOverrides),
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
  return schoolOSFeatureAccess(policy.plan?.entitlements ?? {}, policy.enforcementEnabled, policy.featureOverrides, feature).enabled;
}

export async function assertFeatureEntitled(organizationId: string, feature: string) {
  const policy = await commercialPolicySnapshot(organizationId);
  const decision = schoolOSFeatureAccess(policy.plan?.entitlements ?? {}, policy.enforcementEnabled, policy.featureOverrides, feature);
  if (decision.enabled) return policy;
  throw new AppError(403, "PLAN_FEATURE_REQUIRED", `Your subscription plan does not include ${feature} or platform access has been disabled`);
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

      let quotedSettings: Prisma.InputJsonValue | undefined;
      let settledAddonLines: SchoolOSApprovedAddonLine[] | null = null;
      if (invoice.schoolOSQuoteId) {
        const quote = await tx.schoolOSQuotation.findUnique({
          where: { id: invoice.schoolOSQuoteId },
          include: { contractDocument: { include: { lead: { select: { wonOrganizationId: true } } } } },
        });
        if (!quote || quote.organizationId !== invoice.organizationId || quote.status !== "PAYMENT_PENDING"
          || quote.planCode !== invoice.plan.code || quote.totalPaise !== invoice.totalPaise
          || quote.billingCycle !== "ANNUAL" || quote.contractDocumentId === null) {
          throw new AppError(409, "SCHOOLOS_QUOTE_SETTLEMENT_CONFLICT", "Quoted invoice or contracted subscription does not match the captured payment");
        }
        const signed = await tx.saaSCommercialDocument.findUnique({
          where: { id: quote.contractDocumentId }, select: { verificationStatus: true, archivedAt: true, documentReference: true },
        });
        if (!signed || signed.archivedAt || signed.verificationStatus !== "VERIFIED"
          || signed.documentReference !== quote.quoteNo) {
          throw new AppError(409, "SCHOOLOS_CONTRACT_SETTLEMENT_BLOCKED", "Signed contract is no longer verified; payment requires finance reconciliation");
        }
        const invoiceMeta = record(invoice.metadata);
        const hasItems = Array.isArray(quote.items) && quote.items.length > 0;
        if (hasItems) {
          if (invoiceMeta.basis !== "SIGNED_ANNUAL_BASE_PLUS_ADDONS")
            throw new AppError(409, "SCHOOLOS_ADDON_INVOICE_BASIS_MISMATCH", "Add-on payment invoice basis is missing");
          const priceSnapshot = record(quote.pricingSnapshot);
          const rateSnapshot = priceSnapshot.addonRateSnapshot;
          const rateIds = Array.isArray(rateSnapshot) ? rateSnapshot.map(x=>record(x).rateId).filter((x):x is string=>typeof x==="string") : [];
          const approvedRates = await tx.schoolOSAddonRate.findMany({where:{id:{in:rateIds}}});
          const verified = validateSchoolOSAddonCheckout(quote, invoice.plan, quote.contractDocument,
            invoice.organizationId, approvedRates, new Date(), true);
          if (invoice.amountPaise !== verified.baseAmountPaise + verified.addonsAmountPaise
             || invoice.taxPaise !== verified.taxPaise || invoice.totalPaise !== verified.totalPaise)
            throw new AppError(409,"SCHOOLOS_ADDON_CAPTURE_AMOUNT_MISMATCH","Paid invoice differs from signed finance approved amount");
          settledAddonLines = verified.lines;
        } else if (invoiceMeta.basis === "SIGNED_ANNUAL_BASE_PLUS_ADDONS") {
          throw new AppError(409,"SCHOOLOS_ADDON_EMPTY_INVOICE","Add-on invoice has no add-on lines");
        }
        // Lock tenant settings against concurrent platform licensing edits.
        await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-features:" + invoice.organizationId}))`;
        const org = await tx.organization.findUnique({ where: { id: invoice.organizationId }, select: { settings: true } });
        if (!org) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Customer tenant not found");
        const settings = record(org.settings);
        const commercial = record(settings.commercialEntitlements);
        quotedSettings = { ...settings, commercialEntitlements: { ...commercial, enforce: true } } as Prisma.InputJsonValue;
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
          ...(quotedSettings === undefined ? {} : { settings: quotedSettings }),
        },
      });
      if (invoice.schoolOSQuoteId) {
        const paid = await tx.schoolOSQuotation.updateMany({
          where: { id: invoice.schoolOSQuoteId, organizationId: invoice.organizationId, status: "PAYMENT_PENDING" },
          data: { status: "PAID", version: { increment: 1 } },
        });
        if (paid.count !== 1) throw new AppError(409, "SCHOOLOS_QUOTE_SETTLEMENT_CONFLICT", "Unable to atomically record the paid quotation");
        const settledQuote = await tx.schoolOSQuotation.findUniqueOrThrow({ where: { id: invoice.schoolOSQuoteId } });
        await tx.schoolOSQuotationRevision.create({
          data: { quoteId: settledQuote.id, version: settledQuote.version, action: "VERIFIED_PAYMENT_CAPTURED",
            actorId: "RAZORPAY_WEBHOOK", snapshot: { invoiceId: invoice.id, providerOrderId: payment.order_id,
              providerPaymentId: payment.id, paidAmountPaise: payment.amount, currency: payment.currency,
              activatedPlanCode: invoice.plan.code, periodEnd: invoice.periodEnd.toISOString() } as Prisma.InputJsonValue },
        });
        await tx.auditLog.create({
          data: { organizationId: invoice.organizationId, action: "SCHOOLOS_CONTRACT_PAYMENT_CAPTURED",
            entity: "SchoolOSQuotation", entityId: settledQuote.id,
            metadata: { invoiceId: invoice.id, paymentId: payment.id, totalPaise: payment.amount, planCode: invoice.plan.code } },
        });
      }
      if (invoice.schoolOSQuoteId && settledAddonLines) {
        await applySchoolOSPaidAddonSettlement(tx, {
          organizationId: invoice.organizationId, invoiceId: invoice.id,
          quoteId: invoice.schoolOSQuoteId, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd,
          totalPaise: invoice.totalPaise, lines: settledAddonLines,
        });
      }
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
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${lockKey}))`;
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
