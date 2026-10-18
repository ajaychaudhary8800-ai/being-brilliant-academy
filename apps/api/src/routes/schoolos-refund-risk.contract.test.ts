import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Razorpay risk events reach service only after HMAC validation",async()=>{
  const route=await readFile(new URL("payments.ts",import.meta.url),"utf8");
  const key=route.indexOf("crypto.timingSafeEqual(");
  const call=route.indexOf("await recordSchoolOSPaymentRisk(");
  assert.ok(key>=0 && call>key,"provider webhook verification must happen first");
  assert.match(route,/event\.event === "refund.processed"/);
  assert.match(route,/event\.event === "payment.dispute.created"/);
  assert.match(route,/event\.event === "payment.dispute.lost"/);
  assert.match(route,/child\.payment_id!==original\.id/);
  assert.doesNotMatch(route,/router\.post\("\/platform\/schoolos\/refund"/);
});
test("risk ledger verifies captured original payment and stores immutable provider adjustment",async()=>{
  const service=await readFile(new URL("../lib/schoolos-payment-risk.ts",import.meta.url),"utf8");
  assert.match(service,/invoice\.status!=="PAID"/);
  assert.match(service,/payment\.invoiceId!==invoice\.id/);
  assert.match(service,/payment\.organizationId!==invoice\.organizationId/);
  assert.match(service,/providerPaymentId:e\.providerPaymentId/);
  assert.match(service,/schoolOSPaymentAdjustment\.create/);
  assert.match(service,/schoolOSPaymentRiskHold\.upsert/);
  assert.match(service,/SCHOOLOS_RISK_EVENT_REPLAY_CONFLICT/);
});
test("held invoice cannot grant modules or usage through app or raw PostgreSQL inserts",async()=>{
  const plan=await readFile(new URL("../lib/saas-commercial.ts",import.meta.url),"utf8");
  const usage=await readFile(new URL("../lib/schoolos-usage-service.ts",import.meta.url),"utf8");
  const migration=await readFile(new URL("../../prisma/migrations/20261019020000_schoolos_payment_risk_holds/migration.sql",import.meta.url),"utf8");
  assert.match(plan,/schoolOSPaymentRiskHold: \{ is: null \}/);
  assert.match(usage,/SCHOOLOS_USAGE_PAYMENT_RISK_HOLD/);
  assert.match(migration,/schoolos_license_paid_guard_fn/);
  assert.match(migration,/schoolos_usage_event_tenant_guard_fn/);
  assert.match(migration,/SCHOOLOS_USAGE_UNPAID_FOREIGN_OR_HELD_INVOICE/);
  assert.doesNotMatch(migration,/DELETE FROM "SchoolOSUsageBalance"/);
  assert.doesNotMatch(migration,/UPDATE "SaaSSubscription"/);
});
