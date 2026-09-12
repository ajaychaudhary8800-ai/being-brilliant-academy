import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./finance-workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar.tsx", import.meta.url), "utf8");

test("active Fee Plans are presented as immutable and only drafts expose edit", () => {
  assert.match(source, /plan\.status === "DRAFT"/);
  assert.match(source, /Active plans are immutable/);
  assert.match(source, /canManage && plan\.status === "DRAFT"[^]*onEdit\(plan\)/);
});

test("assignment submits only student and plan identifiers", () => {
  assert.match(source, /JSON\.stringify\(\{ studentId: assignmentDraft\.studentId, feePlanId: assignmentDraft\.feePlanId \}\)/);
  assert.match(source, /Amounts, dates and enrollment context come only from the selected plan and student/);
});

test("Accountants retain read and collection UX without refund or reversal actions", () => {
  assert.match(source, /const canManage = user\?\.role === "SUPER_ADMIN" \|\| user\?\.role === "BRANCH_ADMIN"/);
  assert.match(source, /canOffset=\{canManage\}/);
  assert.match(source, /onCollect=\{setCollecting\}/);
});

test("offset intent reserves one stable key and refreshes only after server success", () => {
  assert.match(source, /setOffsetIntent\(\{ type, fee, payment, key: newFinanceOperationKey\(type\) \}\)/);
  assert.match(source, /idempotencyKey: offsetIntent\.key/);
  assert.match(source, /Effective paid balance is/);
  assert.match(source, /await load\(\)/);
});

test("historical payments and immutable offsets remain visible", () => {
  assert.match(source, /Original payment/);
  assert.match(source, /Net contribution/);
  assert.match(source, /Neither can be edited or deleted/);
  assert.doesNotMatch(source, /delete.*paymentOffset/i);
});

test("branch filters are sent back to every authoritative finance read", () => {
  for (const endpoint of ["fees/dashboard", "fees?", "fee-plans", "fee-assignments", "payment-offsets"]) assert.match(source, new RegExp(endpoint.replace(/[?]/g, "\\?")));
  assert.match(source, /branchId=\$\{encodeURIComponent\(branchId\)\}/);
});

test("school and coaching navigation preserve distinct fee terminology", () => {
  assert.match(sidebar, /School Fees & Finance/);
  assert.match(sidebar, /Course Fees & Finance/);
  assert.match(sidebar, /terms\.mode === "SCHOOL" \? "School Fees"/);
});

test("finance rows use server pagination and institution-local event boundaries", () => {
  assert.match(source, /request<\{ data: Fee\[\]; meta: PageMeta \}>/);
  assert.match(source, /request<\{ data: PaymentRow\[\]; meta: PageMeta \}>/);
  assert.match(source, /request<\{ data: PaymentOffset\[\]; meta: PageMeta \}>/);
  assert.match(source, /<Pagination meta=\{feeMeta\}/);
  assert.match(source, /<Pagination meta=\{paymentMeta\}/);
  assert.match(source, /<Pagination meta=\{offsetMeta\}/);
  assert.doesNotMatch(source, /paymentDate\.slice\(0, 10\)/);
  assert.doesNotMatch(source, /createdAt\.slice\(0, 10\)/);
  assert.match(source, /institutionDateTimeInput\(new Date\(\), settings\.timeZone\)/);
});

test("finance assignment and installment displays avoid browser-local date formatting", () => {
  assert.match(source, /formatInstitutionDateTime\(item\.assignedAt, settings\)/);
  assert.match(source, /formatInstitutionDate\(installment\.dueDate, settings\.locale\)/);
  assert.doesNotMatch(source, /toLocaleDateString/);
  assert.doesNotMatch(source, /new Date\(\)\.getFullYear\(\)/);
});

test("student assignment and manual Fee creation use bounded server-side lookup", () => {
  assert.match(source, /new URLSearchParams\(\{ page: "1", limit: "20", status: "active", search: studentSearch\.trim\(\) \}\)/);
  assert.match(source, /studentSearch\.trim\(\)\.length < 2/);
  assert.match(source, /withSelectedLookupItem\(students, selected/);
  assert.doesNotMatch(source, /admin\/students\?limit=100/);
  assert.match(source, /JSON\.stringify\(\{ studentId: assignmentDraft\.studentId, feePlanId: assignmentDraft\.feePlanId \}\)/);
});

test("invalid report ranges stay client-side and provide a controlled message", () => {
  assert.match(source, /reportFrom > reportTo/);
  assert.match(source, /From date must be on or before To date\./);
  assert.match(source, /max=\{to\}/);
  assert.match(source, /min=\{from\}/);
});
