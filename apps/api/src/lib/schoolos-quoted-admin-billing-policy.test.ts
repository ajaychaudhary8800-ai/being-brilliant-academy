import assert from "node:assert/strict";
import test from "node:test";
import { OrganizationSubscriptionStatus as Status } from "@prisma/client";
import { assertSchoolOSQuotedBillingAdminGuard as guard } from "./schoolos-quoted-admin-billing-policy.js";

const errorCode = (fn: () => void, expected: string) =>
  assert.throws(fn, (error: unknown) =>
    error instanceof Error && "code" in error && error.code === expected);

test("only signed-quote customers forbid legacy trial reactivation", () => {
  guard(false, Status.TRIAL, false); // Unquoted V4 tenant untouched.
  errorCode(() => guard(true, Status.TRIAL, true),
    "SCHOOLOS_SIGNED_QUOTE_TRIAL_BYPASS_DENIED");
});
test("signed-quote tenants cannot disable paid feature enforcement", () => {
  errorCode(() => guard(true, Status.ACTIVE, false),
    "SCHOOLOS_SIGNED_QUOTE_ENFORCEMENT_REQUIRED");
  errorCode(() => guard(true, Status.PAST_DUE, false),
    "SCHOOLOS_SIGNED_QUOTE_ENFORCEMENT_REQUIRED");
  guard(true, Status.ACTIVE, true);
  guard(true, Status.PAST_DUE, true); // Manual suspension still allowed.
});
