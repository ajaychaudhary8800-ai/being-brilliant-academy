export type CheckedCopyRecoveryEvent = {
  action: "AI_CHECKED_COPY_AUTO_RECOVERY_SUCCEEDED" | "AI_CHECKED_COPY_AUTO_RECOVERY_FAILED";
  createdAt: Date;
};

export const CHECKED_COPY_RECOVERY_BASE_BACKOFF_MS = 60_000;
export const CHECKED_COPY_RECOVERY_MAX_BACKOFF_MS = 30 * 60_000;

export function checkedCopyRecoveryDecision(events: CheckedCopyRecoveryEvent[], now = new Date()) {
  const ordered = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latestSuccess = ordered.find(event => event.action === "AI_CHECKED_COPY_AUTO_RECOVERY_SUCCEEDED");
  const latestFailure = ordered.find(event => event.action === "AI_CHECKED_COPY_AUTO_RECOVERY_FAILED");

  if (latestSuccess && (!latestFailure || latestSuccess.createdAt.getTime() >= latestFailure.createdAt.getTime())) {
    return { retry: false, resolved: true, retryAfterMs: 0, failureCount: 0 };
  }

  const failureCount = ordered.filter(event => event.action === "AI_CHECKED_COPY_AUTO_RECOVERY_FAILED").length;
  if (!latestFailure) return { retry: true, resolved: false, retryAfterMs: 0, failureCount: 0 };

  const exponent = Math.min(Math.max(failureCount - 1, 0), 5);
  const backoffMs = Math.min(
    CHECKED_COPY_RECOVERY_BASE_BACKOFF_MS * 2 ** exponent,
    CHECKED_COPY_RECOVERY_MAX_BACKOFF_MS,
  );
  const retryAt = latestFailure.createdAt.getTime() + backoffMs;
  return {
    retry: now.getTime() >= retryAt,
    resolved: false,
    retryAfterMs: Math.max(0, retryAt - now.getTime()),
    failureCount,
  };
}
