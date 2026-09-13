import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./admin-fees.ts", import.meta.url), "utf8");

test("finance operations dashboard keeps role-aware branch scope and authoritative offset arithmetic", () => {
  const start = source.indexOf('router.get("/fees/dashboard"');
  const endpoint = source.slice(start, source.indexOf('router.get("/fees/reports"', start));
  assert.match(endpoint, /branchWhere\(req, query\.branchId\)/);
  assert.match(endpoint, /feePayment\.aggregate/);
  assert.match(endpoint, /feePaymentOffset\.groupBy/);
  assert.match(endpoint, /feePayment: \{ fee: where \}/);
  assert.match(endpoint, /financeOperationsSummary/);
  assert.match(endpoint, /timeZone = await organizationTimezone\(req\), today = institutionDayRange\(now, timeZone\)/);
  assert.match(endpoint, /institutionCalendarDate\(now, timeZone\)/);
  assert.match(endpoint, /paymentDate: \{ gte: today\.start, lt: today\.endExclusive \}/);
});

test("payment collection converts institution wall time before persistence", () => {
  const start = source.indexOf('router.post("/fees/:id/collect"');
  const endpoint = source.slice(start, source.indexOf('router.get("/fees/payments/:paymentId/receipt"', start));
  assert.match(endpoint, /paymentDate: z\.string\(\)\.trim\(\)\.optional\(\)/);
  assert.match(endpoint, /parseInstitutionDateTimeOrInstant\(raw\.paymentDate, await organizationTimezone\(req\)\)/);
  assert.match(endpoint, /amountPaise: z\.number\(\)\.int\(\)\.positive\(\)\.max\(2_147_483_647\)/);
});

test("fee read model preserves source, receipt and immutable offset evidence", () => {
  assert.match(source, /studentFeeAssignment: \{ select:/);
  assert.match(source, /feePlanComponent: \{ select:/);
  assert.match(source, /receiptNumber: true/);
  assert.match(source, /offsets: \{ orderBy: \{ createdAt: "desc"/);
  assert.match(source, /createdBy: \{ select:/);
});

test("date-range collection reporting stays branch scoped and subtracts both offset types", () => {
  const start = source.indexOf('router.get("/fees/reports"');
  const endpoint = source.slice(start, source.indexOf('router.get("/fees/export"', start));
  assert.match(endpoint, /branchWhere\(req, query\.branchId\)/);
  assert.match(endpoint, /institutionDateRange\(query\.from, query\.to, await organizationTimezone\(req\)\)/);
  assert.match(endpoint, /paymentDate: \{ gte: range\.start, lt: range\.endExclusive \}/);
  assert.match(endpoint, /createdAt: \{ gte: range\.start, lt: range\.endExclusive \}/);
  assert.match(endpoint, /feePayment: \{ fee \}/);
  assert.match(endpoint, /netEffectiveCollectionPaise/);
});

test("payment history is a paginated branch-scoped read model with immutable offsets", () => {
  const start = source.indexOf('router.get("/fees/payments"');
  const endpoint = source.slice(start, source.indexOf('router.get("/fees/:id"', start));
  assert.match(endpoint, /page: z\.coerce\.number\(\)\.int\(\)\.positive/);
  assert.match(endpoint, /limit: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)/);
  assert.match(endpoint, /branchWhere\(req, query\.branchId\)/);
  assert.match(endpoint, /fee: feeScope/);
  assert.match(endpoint, /receiptNumber: \{ contains: query\.search/);
  assert.match(endpoint, /transactionId: \{ contains: query\.search/);
  assert.doesNotMatch(endpoint, /payments: \{ some:/);
  assert.match(endpoint, /skip: \(query\.page - 1\) \* query\.limit/);
  assert.match(endpoint, /offsets:/);
  assert.match(endpoint, /meta: \{ total, page: query\.page, limit: query\.limit, totalPages:/);
});
