#!/usr/bin/env node
/**
 * V5 staging ONLY: guarded Growth annual price reconciliation.
 * Default --check is read-only; --apply requires explicit operator approval.
 * This script does not issue quotations, charge customers, activate a provider,
 * change subscriptions/invoices, deploy V5 or alter V4 production.
 */
import {
  assertV5StagingBootstrapTarget,
} from "./schoolos-v5-qa-guard.mjs";
import {
  GROWTH_OLD_PAISE, GROWTH_APPROVED_PAISE,
  assertV5GrowthStagingTarget, assertV5GrowthPriceApplyApproval,
  evaluateV5GrowthPrice,
} from "./schoolos-v5-growth-price-policy.mjs";

export async function reconcileV5GrowthStaging(prisma, {apply = false, env = process.env} = {}) {
  // Both guards run before ANY database read or write.
  assertV5GrowthStagingTarget(env);
  // This existing guard independently pins the isolated V5 staging database and web origin.
  // It also requires the staging-only QA bootstrap approval marker; the marker
  // authorizes target identification, NOT a commercial release or price change.
  assertV5StagingBootstrapTarget({...env, SCHOOLOS_V5_QA_BOOTSTRAP_APPROVED: "ISOLATED_STAGING_ONLY"});
  if (apply) assertV5GrowthPriceApplyApproval(env);

  return prisma.$transaction(async tx => {
    const plan = await tx.saaSPlan.findUnique({
      where: {code: "GROWTH"},
      select: {id: true, code: true, currency: true, annualPricePaise: true,
        taxRateBps: true, isActive: true},
    });
    const [quotes, invoices, subscriptions] = await Promise.all([
      tx.schoolOSQuotation.count({where: {planCode: "GROWTH"}}),
      plan ? tx.saaSInvoice.count({where: {planId: plan.id}}) : Promise.resolve(0),
      plan ? tx.saaSSubscription.count({where: {planId: plan.id}}) : Promise.resolve(0),
    ]);
    const decision = evaluateV5GrowthPrice({plan, quotes, invoices, subscriptions});
    const snapshot = {
      status: decision.status,
      mode: apply ? "APPLY" : "CHECK_ONLY",
      currentAnnualPaise: plan?.annualPricePaise ?? null,
      approvedAnnualPaise: GROWTH_APPROVED_PAISE,
      dependencies: {quotes, invoices, subscriptions},
      changed: false,
      commercialReleaseAuthorized: false,
    };
    if (!apply || decision.status === "ALIGNED_NO_CHANGE") return snapshot;
    if (decision.status !== "CHANGE_SAFE_STAGING_ONLY")
      throw new Error("REFUSED_GROWTH_PRICE_UNSAFE_" + decision.status);

    // Compare-and-swap under a serializable transaction; no historical
    // quote, invoice or subscription is ever rewritten.
    const updated = await tx.saaSPlan.updateMany({
      where: {id: plan.id, code: "GROWTH", annualPricePaise: GROWTH_OLD_PAISE,
        currency: "INR", taxRateBps: 1800, isActive: true},
      data: {annualPricePaise: GROWTH_APPROVED_PAISE},
    });
    if (updated.count !== 1) throw new Error("REFUSED_GROWTH_PRICE_CONCURRENT_CHANGE");
    const audit = await tx.auditLog.create({
      data: {
        organizationId: "org_default",
        action: "SCHOOLOS_V5_STAGING_GROWTH_PRICE_RECONCILED",
        entity: "SaaSPlan", entityId: plan.id,
        metadata: {
          oldAnnualPaise: GROWTH_OLD_PAISE,
          newAnnualPaise: GROWTH_APPROVED_PAISE,
          approvalReference: env.SCHOOLOS_V5_GROWTH_APPROVAL_REFERENCE,
          claimedApproverEmail: env.SCHOOLOS_V5_GROWTH_APPROVER_EMAIL,
          stagingOnly: true,
          independentApprovalVerifiedByScript: false,
        },
      },
    });
    return {...snapshot, status: "APPLIED_STAGING_ONLY",
      currentAnnualPaise: GROWTH_APPROVED_PAISE, changed: true, auditId: audit.id};
  }, {isolationLevel: "Serializable", maxWait: 5000, timeout: 15000});
}

if (process.argv[1]?.endsWith("schoolos-v5-growth-price-reconcile.mjs")) {
  const args = process.argv.slice(2);
  const apply = args.length === 1 && args[0] === "--apply";
  const check = args.length === 0 || (args.length === 1 && args[0] === "--check");
  if (!apply && !check) {
    console.error("USAGE: node scripts/schoolos-v5-growth-price-reconcile.mjs [--check|--apply]");
    process.exitCode = 2;
  } else {
    let prisma;
    try {
      // Refuse unsafe targets before importing or connecting to Prisma.
      assertV5GrowthStagingTarget(process.env);
      if (apply) assertV5GrowthPriceApplyApproval(process.env);
      const {PrismaClient} = await import("@prisma/client");
      prisma = new PrismaClient({log: ["error"]});
      const result = await reconcileV5GrowthStaging(prisma, {apply});
      console.log("SCHOOLOS_V5_GROWTH_RECONCILIATION " + JSON.stringify(result));
      if (result.status.startsWith("BLOCKED_")) process.exitCode = 2;
    } catch (error) {
      // No credentials, connection strings or database error details are printed.
      console.error("SCHOOLOS_V5_GROWTH_RECONCILIATION_REFUSED");
      process.exitCode = 1;
    } finally {
      if (prisma) await prisma.$disconnect();
    }
  }
}
