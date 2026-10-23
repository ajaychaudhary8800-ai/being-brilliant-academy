/**
 * Staging-only commercial pricebook reconciliation.
 * Read-only by default; --apply requires an exact isolated database/origin,
 * TEST provider mode and a separate owner-approved opt-in.
 *
 * Run from the staging API working directory after code review:
 *   node dist/src/scripts/schoolos-v5-staging-pricebook.js
 * Never execute on V4 production. This does NOT approve customer issuance.
 */
import { Prisma } from "@prisma/client";
import { systemPrisma } from "../lib/prisma.js";
import { FIXED_V5_PLANS, assertV5StagingPricebookTarget, stagingPricebookPlan, type StagingPlanSnapshot } from "../lib/schoolos-staging-pricebook-policy.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply") || args.filter(arg => arg === "--apply").length > 1)
    throw new Error("Only optional --apply is supported");
  const apply = args.includes("--apply");
  // Must run BEFORE connecting to the database.
  assertV5StagingPricebookTarget(process.env, apply);

  const execute = async (tx: Prisma.TransactionClient) => {
    // Do not race with another authorised run of the same maintenance script.
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-v5-staging-pricebook-20261023"}))`;
    const rows = await tx.saaSPlan.findMany({ where: { code: { in: [...FIXED_V5_PLANS] } },
      select: { id: true, code: true, annualPricePaise: true, currency: true, taxRateBps: true, isActive: true } });
    const plans: StagingPlanSnapshot[] = await Promise.all(rows.map(async plan => {
      const [existingQuotes, paidInvoices, outstandingInvoices] = await Promise.all([
        // Even DRAFT or REJECTED quote snapshots can later be submitted; never
        // silently reprice the catalogue beneath their frozen amounts.
        tx.schoolOSQuotation.count({ where: { planCode: plan.code } }),
        tx.saaSInvoice.count({ where: { planId: plan.id, status: "PAID" } }),
        tx.saaSInvoice.count({ where: { planId: plan.id, status: { in: ["DRAFT", "OPEN", "OVERDUE"] } } }),
      ]);
      return { ...plan, existingQuotes, paidInvoices, outstandingInvoices };
    }));
    const actions = stagingPricebookPlan(plans);
    const blocked = actions.filter(x => x.status === "BLOCKED");
    if (apply && blocked.length)
      throw new Error("PRICEBOOK_BLOCKED_BY_EXISTING_COMMERCIAL_STATE: " +
        blocked.map(x => x.planCode).join(","));
    if (apply) {
      for (const a of actions.filter(action => action.status === "CHANGE_SAFE")) {
        const saved = await tx.saaSPlan.updateMany({
          where: { id: a.planId, code: a.planCode, annualPricePaise: a.previousPaise,
            currency: "INR", taxRateBps: 1800, isActive: true },
          data: { annualPricePaise: a.proposedPaise },
        });
        if (saved.count !== 1) throw new Error("PRICEBOOK_CONCURRENT_CHANGE: " + a.planCode);
        // Audit is written in the SAME transaction as the plan change.
        // This records an operator-run staging action, NOT finance/legal signoff.
        await tx.auditLog.create({ data: {
          organizationId: "org_default",
          action: "SCHOOLOS_V5_STAGING_PRICEBOOK_APPLIED",
          entity: "SaaSPlan", entityId: a.planId,
          metadata: {
            planCode: a.planCode, oldAnnualPricePaise: a.previousPaise,
            newAnnualPricePaise: a.proposedPaise,
            referenceId: "SCHOOLOS-LAUNCH-2027-INDIA-V1",
            target: "schoolos_v5_staging", financeSignoffRecorded: false,
          } as Prisma.InputJsonValue,
        } });
      }
    }
    return { mode: apply ? "STAGING_APPLIED" : "STAGING_DRY_RUN", target: "schoolos_v5_staging",
      approvedReference: "SCHOOLOS-LAUNCH-2027-INDIA-V1",
      blocked: blocked.length, changed: apply
        ? actions.filter(x => x.status === "CHANGE_SAFE").length : 0,
      actions,
      externalIssuanceAuthorized: false, productionModified: false };
  };
  const output = apply
    ? await systemPrisma.$transaction(execute, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000,
      })
    : await systemPrisma.$transaction(execute, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 30_000,
      });
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  // No DATABASE_URL, credentials, provider tokens or raw database details in logs.
  const known = /^(PRICEBOOK_|DATABASE_URL|Only optional)/.test(error?.message ?? "");
  console.error(known ? error.message : "V5_STAGING_PRICEBOOK_FAILED");
  process.exitCode = 1;
}).finally(async () => { await systemPrisma.$disconnect(); });
