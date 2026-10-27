#!/usr/bin/env node
/**
 * Isolated V5 staging: read-only Growth annual rate-book inspection.
 * No updates, webhook calls, invoices, quotation issuance or provider requests.
 *
 * Run ONLY inside the V5 staging API container, after manual staging promotion.
 * Production and the older V4 main staging environment are not permitted.
 */
import { assertV5GrowthStagingTarget, evaluateV5GrowthPrice } from "./schoolos-v5-growth-price-policy.mjs";

try {
  if (process.argv.length !== 2) throw new Error("REFUSED_UNEXPECTED_ARGS");
  assertV5GrowthStagingTarget(process.env);
  // The database module is deliberately loaded AFTER the exact target guard.
  const { systemPrisma } = await import("../dist/src/lib/prisma.js");
  try {
    const plan = await systemPrisma.saaSPlan.findUnique({
      where: { code: "GROWTH" },
      select: { id: true, code: true, annualPricePaise: true, currency: true, taxRateBps: true, isActive: true },
    });
    // Count all historical commercial dependencies, regardless of their status.
    // A plan must not be silently repriced when any dependent record exists.
    const [quotes, invoices, subscriptions] = await Promise.all([
      systemPrisma.schoolOSQuotation.count({ where: { planCode: "GROWTH" } }),
      plan ? systemPrisma.saaSInvoice.count({ where: { planId: plan.id } }) : Promise.resolve(0),
      plan ? systemPrisma.saaSSubscription.count({ where: { planId: plan.id } }) : Promise.resolve(0),
    ]);
    const result = evaluateV5GrowthPrice({ plan, quotes, invoices, subscriptions });
    console.log("V5_STAGING_GROWTH_READ_ONLY=PASS");
    console.log("CURRENT_ANNUAL_PAISE=" + (plan?.annualPricePaise ?? "UNKNOWN"));
    console.log("GROWTH_RATEBOOK_STATUS=" + result.status);
    console.log("GROWTH_QUOTES=" + quotes);
    console.log("GROWTH_INVOICES=" + invoices);
    console.log("GROWTH_SUBSCRIPTIONS=" + subscriptions);
    console.log("CHANGES_MADE=NO");
    console.log("COMMERCIAL_RELEASE_AUTHORIZED=NO");
    if (!["ALIGNED_NO_CHANGE", "CHANGE_SAFE_STAGING_ONLY"].includes(result.status)) process.exitCode = 2;
  } finally {
    await systemPrisma.$disconnect();
  }
} catch {
  // No credentials, stack traces or database URLs in output.
  console.error("V5_STAGING_GROWTH_READ_ONLY=REFUSED_OR_FAILED");
  process.exitCode = 1;
}
