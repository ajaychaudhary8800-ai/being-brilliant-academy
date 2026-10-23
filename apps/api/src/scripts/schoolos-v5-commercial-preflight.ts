/**
 * Operator-run V5 staging-only commercial diagnostic.
 * NO --apply mode: query plans and invoice/quotation COUNTS only.
 * No customer/user/email/secret values or provider calls appear in output.
 *
 * Run inside reviewed isolated V5 staging API with DATABASE_URL, WEB_URL
 * and RAZORPAY_MODE=test, after verifying deployed source image provenance:
 *   pnpm --filter @bba/api exec tsx src/scripts/schoolos-v5-commercial-preflight.ts
 */
import { Prisma } from "@prisma/client";
import { systemPrisma } from "../lib/prisma.js";
import { FIXED_V5_PLANS, assertV5StagingPricebookTarget, type StagingPlanSnapshot } from "../lib/schoolos-staging-pricebook-policy.js";
import { assessSchoolOSCommercialPreflight } from "../lib/schoolos-commercial-preflight.js";

async function main() {
  if (process.argv.slice(2).length) throw new Error("PREFLIGHT_READ_ONLY_NO_ARGUMENTS");
  // Fail closed BEFORE opening PostgreSQL if this is V4 production/shared staging.
  assertV5StagingPricebookTarget(process.env, false);
  const report = await systemPrisma.$transaction(async tx => {
    const plans = await tx.saaSPlan.findMany({
      where: { code: { in: [...FIXED_V5_PLANS, "ENTERPRISE"] } },
      select: { id:true, code:true, annualPricePaise:true, currency:true, taxRateBps:true, isActive:true },
    });
    const fixed: StagingPlanSnapshot[] = await Promise.all(
      plans.filter(plan => FIXED_V5_PLANS.some(tier => tier === plan.code)).map(async plan => {
        const [existingQuotes, paidInvoices, outstandingInvoices] = await Promise.all([
          tx.schoolOSQuotation.count({ where: { planCode: plan.code } }),
          tx.saaSInvoice.count({ where: { planId: plan.id, status: "PAID" } }),
          tx.saaSInvoice.count({ where: { planId: plan.id, status: { in: ["DRAFT","OPEN","OVERDUE"] } } }),
        ]);
        return { ...plan, existingQuotes, paidInvoices, outstandingInvoices };
      }),
    );
    return assessSchoolOSCommercialPreflight(plans, fixed, process.env);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 30_000 });
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  // NEVER print connection URI, environment values, database content or stack.
  const message = error instanceof Error ? error.message : "";
  console.error(/^(PRICEBOOK_TARGET_NOT_ISOLATED_V5_STAGING|PREFLIGHT_READ_ONLY_NO_ARGUMENTS)$/.test(message)
    ? message : "SCHOOLOS_V5_COMMERCIAL_PREFLIGHT_FAILED");
  process.exitCode = 1;
}).finally(async () => { await systemPrisma.$disconnect(); });
