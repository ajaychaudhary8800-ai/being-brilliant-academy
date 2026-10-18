import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
test("dispute won notification cannot automatically clear customer hold",async()=>{
  const handler=await readFile(new URL("../lib/schoolos-payment-risk.ts",import.meta.url),"utf8");
  const paymentRouter=await readFile(new URL("payments.ts",import.meta.url),"utf8");
  assert.match(handler,/payment\.dispute\.won/);
  assert.match(handler,/SCHOOLOS_RISK_DISPUTE_NOT_RAISED/);
  assert.match(paymentRouter,/event\.event === "payment\.dispute\.won"/);
  assert.match(paymentRouter,/crypto\.timingSafeEqual/);
  assert.doesNotMatch(handler,/schoolOSPaymentRiskHold\.delete/);
});
test("releasing risk requires distinct platform admins and unchanged provider event revision",async()=>{
  const route=await readFile(new URL("schoolos-payment-risk-review.ts",import.meta.url),"utf8");
  const svc=await readFile(new URL("../lib/schoolos-risk-resolution.ts",import.meta.url),"utf8");
  const policy=await readFile(new URL("../lib/schoolos-dispute-release-policy.ts",import.meta.url),"utf8");
  assert.match(route,/homeOrganizationId!=="org_default"/);
  assert.match(svc,/review\.proposedBy===reviewedBy/);
  assert.match(svc,/hold\.revision!==review\.riskRevision/);
  assert.match(svc,/schoolOSDisputeReleasePolicy\(adjustments\)/);
  assert.match(svc,/lockRisk\(tx,initial\.invoiceId\)/);
  assert.match(svc,/lockUsage\(tx,hold\.organizationId\)/);
  assert.match(policy,/PROCESSED_REFUND_EXISTS/);
  assert.match(policy,/LOST_DISPUTE_EXISTS/);
});
test("schema and SQL deny self approval, stale review and unsafe risk states",async()=>{
  const sql=await readFile(new URL("../../prisma/migrations/20261019030000_schoolos_dispute_finance_resolution/migration.sql",import.meta.url),"utf8");
  assert.match(sql,/"reviewedBy" <> "proposedBy"/);
  assert.match(sql,/CREATE UNIQUE INDEX "SchoolOSPaymentRiskReview_invoiceId_riskRevision_key"/);
  assert.match(sql,/ADD CONSTRAINT "SchoolOSPaymentRiskHold_state_check"/);
  assert.doesNotMatch(sql,/DELETE FROM "SchoolOSPaymentRiskHold"/);
  assert.doesNotMatch(sql,/UPDATE "SaaSSubscription"/);
});
