export type WorkerHeartbeat = {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
};

export function workerHealthSnapshot(heartbeat: WorkerHeartbeat, maxAgeMs: number, now = new Date()) {
  const success = heartbeat.lastSuccessAt;
  const failure = heartbeat.lastFailureAt;
  const recentSuccess = Boolean(success && now.getTime() - success.getTime() <= maxAgeMs);
  const failedAfterLastSuccess = Boolean(failure && (!success || failure.getTime() >= success.getTime()));

  return {
    healthy: recentSuccess && !failedAfterLastSuccess,
    lastSuccessAt: success?.toISOString() ?? null,
    lastFailureAt: failure?.toISOString() ?? null,
  };
}
