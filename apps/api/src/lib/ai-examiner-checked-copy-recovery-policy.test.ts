import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKED_COPY_RECOVERY_MAX_BACKOFF_MS,
  checkedCopyRecoveryDecision,
  type CheckedCopyRecoveryEvent,
} from "./ai-examiner-checked-copy-recovery-policy.js";

const event = (action: CheckedCopyRecoveryEvent["action"], at: string): CheckedCopyRecoveryEvent => ({
  action,
  createdAt: new Date(at),
});

test("checked-copy recovery retries immediately before any recovery attempt", () => {
  const decision = checkedCopyRecoveryDecision([], new Date("2026-10-05T18:00:00.000Z"));
  assert.equal(decision.retry, true);
  assert.equal(decision.resolved, false);
});

test("checked-copy recovery backs off after a failed attempt", () => {
  const decision = checkedCopyRecoveryDecision(
    [event("AI_CHECKED_COPY_AUTO_RECOVERY_FAILED", "2026-10-05T17:59:30.000Z")],
    new Date("2026-10-05T18:00:00.000Z"),
  );
  assert.equal(decision.retry, false);
  assert.equal(decision.retryAfterMs, 30_000);
  assert.equal(decision.failureCount, 1);
});

test("checked-copy recovery uses exponential backoff with a cap", () => {
  const events = Array.from({ length: 8 }, (_, index) =>
    event("AI_CHECKED_COPY_AUTO_RECOVERY_FAILED", `2026-10-05T17:${String(59 - index).padStart(2, "0")}:00.000Z`),
  );
  const decision = checkedCopyRecoveryDecision(events, new Date("2026-10-05T18:00:00.000Z"));
  assert.equal(decision.retry, false);
  assert.ok(decision.retryAfterMs <= CHECKED_COPY_RECOVERY_MAX_BACKOFF_MS);
});

test("checked-copy recovery stops retrying once a later success exists", () => {
  const decision = checkedCopyRecoveryDecision(
    [
      event("AI_CHECKED_COPY_AUTO_RECOVERY_FAILED", "2026-10-05T17:58:00.000Z"),
      event("AI_CHECKED_COPY_AUTO_RECOVERY_SUCCEEDED", "2026-10-05T17:59:00.000Z"),
    ],
    new Date("2026-10-05T18:00:00.000Z"),
  );
  assert.equal(decision.retry, false);
  assert.equal(decision.resolved, true);
});
