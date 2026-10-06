import assert from "node:assert/strict";
import test from "node:test";
import { workerHealthSnapshot, type WorkerHeartbeat } from "./worker-health.js";

const heartbeat = (success: string | null, failure: string | null): WorkerHeartbeat => ({
  lastSuccessAt: success ? new Date(success) : null,
  lastFailureAt: failure ? new Date(failure) : null,
  lastError: failure ? "worker failure" : null,
});

test("worker health requires a recent successful run", () => {
  const now = new Date("2026-10-05T18:00:00.000Z");
  assert.equal(workerHealthSnapshot(heartbeat("2026-10-05T17:59:30.000Z", null), 60_000, now).healthy, true);
  assert.equal(workerHealthSnapshot(heartbeat("2026-10-05T17:58:00.000Z", null), 60_000, now).healthy, false);
  assert.equal(workerHealthSnapshot(heartbeat(null, null), 60_000, now).healthy, false);
});

test("worker health becomes degraded when the latest run failed", () => {
  const now = new Date("2026-10-05T18:00:00.000Z");
  const snapshot = workerHealthSnapshot(
    heartbeat("2026-10-05T17:59:20.000Z", "2026-10-05T17:59:30.000Z"),
    60_000,
    now,
  );
  assert.equal(snapshot.healthy, false);
});

test("a later successful run recovers worker health", () => {
  const now = new Date("2026-10-05T18:00:00.000Z");
  const snapshot = workerHealthSnapshot(
    heartbeat("2026-10-05T17:59:50.000Z", "2026-10-05T17:59:30.000Z"),
    60_000,
    now,
  );
  assert.equal(snapshot.healthy, true);
});
