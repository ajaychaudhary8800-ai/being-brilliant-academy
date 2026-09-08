import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const between = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));

test("fee queries and finance lists use the common authorized branch filter", async () => {
  const fees = await readFile(new URL("./admin-fees.ts", import.meta.url), "utf8");
  const finance = await readFile(new URL("./finance.ts", import.meta.url), "utf8");
  for (const route of ["/fees/dashboard", "/fees/reports", "/fees"]) {
    const start = `router.get(\"${route}\"`;
    const endpoint = fees.slice(fees.indexOf(start), fees.indexOf("router.", fees.indexOf(start) + start.length));
    assert.match(endpoint, /branchWhere\(req/);
  }
  for (const route of ["/finance/accounts", "/finance/entries"]) {
    const start = `router.get(\"${route}\"`;
    const endpoint = finance.slice(finance.indexOf(start), finance.indexOf("router.", finance.indexOf(start) + start.length));
    assert.match(endpoint, /branchWhere\(req, query\.branchId\)/);
    assert.doesNotMatch(endpoint, /branchId:\s*query\.branchId/);
  }
});

test("corrected finance mutations revalidate targets with transaction-scoped reads and resolved branch scope", async () => {
  const finance = await readFile(new URL("./finance.ts", import.meta.url), "utf8");
  const endpoints = [
    between(finance, "async function transitionVoucher", 'router.get("/finance/dashboard"'),
    between(finance, 'router.patch("/finance/vendors/:id"', 'router.get("/finance/expense-categories"'),
    between(finance, 'router.patch("/finance/expenses/:id/approve"', 'router.get("/finance/expenses/:id/attachment"'),
    between(finance, 'router.post("/finance/fee-adjustments"', 'router.get("/finance/banks"'),
    between(finance, 'router.post("/finance/banks/:id/transactions"', 'router.patch("/finance/bank-transactions/:id/reconcile"'),
    between(finance, 'router.patch("/finance/bank-transactions/:id/reconcile"', 'router.get("/finance/gst"'),
  ];
  for (const endpoint of endpoints) {
    assert.match(endpoint, /serializable\(async tx/);
    assert.match(endpoint, /tx\.[a-zA-Z]+\.findUnique/);
    assert.match(endpoint, /assertFinanceBranchAccess/);
    assert.doesNotMatch(endpoint, /await access\(req,/);
  }
});

test("organization-wide finance master mutations are super-admin-only and zero-branch reads return no data", async () => {
  const finance = await readFile(new URL("./finance.ts", import.meta.url), "utf8");
  for (const endpoint of [
    between(finance, 'router.post("/finance/account-groups"', 'router.patch("/finance/account-groups/:id"'),
    between(finance, 'router.patch("/finance/account-groups/:id"', 'router.delete("/finance/account-groups/:id"'),
    between(finance, 'router.delete("/finance/account-groups/:id"', "const account="),
    between(finance, 'router.post("/finance/expense-categories"', "const bill="),
  ]) assert.match(endpoint, /allow\(Role\.SUPER_ADMIN\)/);
  for (const endpoint of [
    between(finance, 'router.get("/finance/account-groups"', 'router.post("/finance/account-groups"'),
    between(finance, 'router.get("/finance/expense-categories"', 'router.post("/finance/expense-categories"'),
  ]) {
    assert.match(endpoint, /canReadFinanceMasterData/);
    assert.match(endpoint, /data: \[\]/);
  }
});

test("system account privilege is enforced for single and imported account creation", async () => {
  const finance = await readFile(new URL("./finance.ts", import.meta.url), "utf8");
  assert.match(between(finance, 'router.post("/finance/accounts"', 'router.patch("/finance/accounts/:id"'), /assertSystemAccountCreationAllowed\(req\.auth!\.role, data\.isSystem\)/);
  assert.match(between(finance, 'router.post("/finance/import/accounts"', 'router.get("/finance/export/:entity"'), /assertSystemAccountCreationAllowed\(req\.auth!\.role, row\.isSystem\)/);
});

test("collection uses authoritative sums in a serializable transaction with duplicate and audit guards", async () => {
  const fees = await readFile(new URL("./admin-fees.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const endpoint = between(fees, 'router.post("/fees/:id/collect"', 'router.get("/fees/payments/:paymentId/receipt"');
  assert.match(endpoint, /TransactionIsolationLevel\.Serializable/);
  assert.equal([...endpoint.matchAll(/feePayment\.aggregate/g)].length, 2);
  assert.match(endpoint, /feePayment\.findUnique/);
  assert.match(endpoint, /assertPaymentWithinAuthoritativeBalance/);
  assert.match(endpoint, /amountPaidPaise = authoritative\._sum\.amountPaise/);
  assert.match(endpoint, /PAYMENT_CREATED/);
  assert.match(endpoint, /RECEIPT_ISSUED/);
  assert.doesNotMatch(endpoint, /Math\.random/);
  const paymentModel = between(schema, "model FeePayment {", "model Test {");
  assert.match(paymentModel, /transactionId\s+String\?\s+@unique/);
  assert.match(paymentModel, /receiptNumber\s+String\s+@unique/);
});

test("paid fee identity check and mutation share a serializable transaction", async () => {
  const fees = await readFile(new URL("./admin-fees.ts", import.meta.url), "utf8");
  const endpoint = between(fees, 'router.patch("/fees/:id"', 'router.post("/fees/:id/collect"');
  assert.match(endpoint, /TransactionIsolationLevel\.Serializable/);
  assert.match(endpoint, /_count:\s*\{\s*select:\s*\{\s*payments:\s*true/);
  assert.match(endpoint, /assertPaidFeeIdentityUnchanged/);
  assert.match(endpoint, /tx\.fee\.update/);
  assert.match(endpoint, /FEE_UPDATED/);
});

test("fee deletion revalidates payment and adjustment references in its serializable transaction", async () => {
  const fees = await readFile(new URL("./admin-fees.ts", import.meta.url), "utf8");
  const endpoint = between(fees, 'router.delete("/fees/:id"', "function sendPdf");
  assert.match(endpoint, /TransactionIsolationLevel\.Serializable/);
  assert.match(endpoint, /tx\.fee\.findUnique/);
  assert.match(endpoint, /tx\.feeAdjustment\.count/);
  assert.match(endpoint, /assertFeeCanBeDeleted/);
  assert.match(endpoint, /tx\.fee\.delete/);
  assert.match(endpoint, /FEE_DELETED/);
});

test("expense approval and fee adjustment keep journals, business records, and audits atomic", async () => {
  const finance = await readFile(new URL("./finance.ts", import.meta.url), "utf8");
  const expense = between(finance, 'router.patch("/finance/expenses/:id/approve"', 'router.get("/finance/expenses/:id/attachment"');
  assert.match(expense, /serializable\(async tx/);
  assert.match(expense, /createBalanced\(tx, req/);
  assert.match(expense, /tx\.expenseBill\.update/);
  assert.match(expense, /audit\(tx, req, "APPROVE"/);
  const adjustment = between(finance, 'router.post("/finance/fee-adjustments"', 'router.get("/finance/banks"');
  assert.match(adjustment, /serializable\(async tx/);
  assert.match(adjustment, /tx\.fee\.findUnique/);
  assert.match(adjustment, /assertFinanceBranchAccess/);
  assert.match(adjustment, /createBalanced\(tx, req/);
  assert.match(adjustment, /tx\.feeAdjustment\.create/);
  assert.match(adjustment, /audit\(tx, req, "CREATE", "FeeAdjustment"/);
});

test("voucher post and archive use one conditional transition and audit transaction", async () => {
  const finance = await readFile(new URL("./finance.ts", import.meta.url), "utf8");
  const transition = between(finance, "async function transitionVoucher", 'router.get("/finance/dashboard"');
  assert.match(transition, /serializable\(async tx/);
  assert.match(transition, /tx\.journalEntry\.findUnique/);
  assert.match(transition, /assertVoucherCanTransition/);
  assert.match(transition, /tx\.journalEntry\.updateMany/);
  assert.match(transition, /status: JournalStatus\.DRAFT/);
  assert.match(transition, /assertVoucherTransitionApplied/);
  assert.match(transition, /await audit\(tx/);
});

test("parent fee viewing remains available while unverified self-recorded payments are disabled", async () => {
  const portals = await readFile(new URL("./portals.ts", import.meta.url), "utf8");
  const payment = between(portals, 'router.post("/parent/children/:studentId/fees/:feeId/pay"', 'router.get("/teacher/dashboard"');
  assert.match(payment, /ownedChild/);
  assert.match(payment, /fee\.findFirst/);
  assert.match(payment, /rejectUnverifiedParentPayment/);
  assert.doesNotMatch(payment, /feePayment\.(?:create|update)/);
  assert.doesNotMatch(payment, /fee\.update/);
  const studentData = between(portals, "async function studentData", 'router.get("/student/dashboard"');
  assert.match(studentData, /prisma\.fee\.findMany/);
  assert.match(portals, /router\.get\("\/parent\/dashboard"[^]*studentData/);
});

test("receipt retrieval remains branch-scoped and records regeneration", async () => {
  const fees = await readFile(new URL("./admin-fees.ts", import.meta.url), "utf8");
  const receipt = between(fees, 'router.get("/fees/payments/:paymentId/receipt"', 'router.delete("/fees/:id"');
  assert.match(receipt, /await access\(req, payment\.fee\.branchId\)/);
  assert.match(receipt, /RECEIPT_REGENERATED/);
});

test("Accountant finance access is branch-scoped and read-only except collection", async () => {
  const finance = await readFile(new URL("./finance.ts", import.meta.url), "utf8");
  const fees = await readFile(new URL("./admin-fees.ts", import.meta.url), "utf8");
  assert.match(finance, /allow\(Role\.SUPER_ADMIN, Role\.BRANCH_ADMIN, Role\.ACCOUNTANT\)/);
  assert.match(finance, /req\.auth\?\.role === Role\.ACCOUNTANT && req\.method !== "GET"/);
  assert.match(finance, /Role\.ACCOUNTANT \? \(await prisma\.branchUser\.findMany/);
  assert.match(fees, /allow\(Role\.SUPER_ADMIN, Role\.BRANCH_ADMIN, Role\.ACCOUNTANT\)/);
  assert.match(fees, /req\.auth\?\.role === Role\.ACCOUNTANT/);
  assert.match(fees, /req\.method === "POST" && \/\^\\\/fees/);
});
