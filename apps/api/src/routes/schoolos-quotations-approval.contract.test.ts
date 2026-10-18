import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = () => readFile(new URL("schoolos-quotations.ts", import.meta.url), "utf8");

test("only platform administrator approves with independent author and latest editor", async () => {
  const code = await source();
  const start = code.indexOf('router.post("/platform/schoolos/quotes/:id/decision"');
  const route = code.slice(start);
  assert.ok(start >= 0);
  assert.match(route, /requirePlatformAdmin\(req\)/);
  assert.match(route, /current\.createdBy === req\.auth!\.userId/);
  assert.match(route, /current\.updatedBy === req\.auth!\.userId/);
  assert.match(route, /SCHOOLOS_QUOTE_SEPARATION_OF_DUTIES/);
});

test("approval transitions are state fenced, versioned and audit logged", async () => {
  const code = await source();
  assert.match(code, /SUBMIT_FOR_REVIEW: \{ expected: "DRAFT", next: "PENDING_APPROVAL" \}/);
  assert.match(code, /APPROVE: \{ expected: "PENDING_APPROVAL", next: "INTERNALLY_APPROVED" \}/);
  assert.match(code, /REJECT: \{ expected: "PENDING_APPROVAL", next: "REJECTED" \}/);
  assert.match(code, /RETURN_TO_DRAFT: \{ expected: "REJECTED", next: "DRAFT" \}/);
  assert.match(code, /version: input\.expectedVersion, status: transition\.expected/);
  assert.match(code, /schoolOSQuotationRevision\.create/);
  assert.match(code, /SCHOOLOS_QUOTE_" \+ input\.decision/);
  assert.match(code, /externalIssueAllowed: false, subscriptionActivated: false/);
  assert.doesNotMatch(code, /schoolOSQuotation\.delete/);
});
