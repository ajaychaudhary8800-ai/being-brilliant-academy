import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import test from "node:test";

const metricsUrl = new URL("../lib/metrics.ts", import.meta.url);
const serverUrl = new URL("../server.ts", import.meta.url);
const httpUrl = new URL("../lib/http.ts", import.meta.url);
const notificationsUrl = new URL("../lib/notifications.ts", import.meta.url);
const uptimeUrl = new URL("../../../../.github/workflows/uptime-monitor.yml", import.meta.url);
const backupUrl = new URL("../../../../infra/backup/backup.sh", import.meta.url);
const backupHealthUrl = new URL("../../../../infra/backup/healthcheck.sh", import.meta.url);
const backupEntryUrl = new URL("../../../../infra/backup/entrypoint.sh", import.meta.url);
const backupDockerUrl = new URL("../../../../infra/backup/Dockerfile", import.meta.url);
const composeUrl = new URL("../../../../docker-compose.yml", import.meta.url);
const monitoringUrl = new URL("../../../../docs/MONITORING.md", import.meta.url);
const incidentUrl = new URL("../../../../docs/INCIDENT_RESPONSE.md", import.meta.url);

test("Step 13 exports application, dependency, notification and worker metrics", async () => {
  const [metrics, http, notifications] = await Promise.all([
    readFile(metricsUrl, "utf8"),
    readFile(httpUrl, "utf8"),
    readFile(notificationsUrl, "utf8"),
  ]);
  for (const metric of [
    "bba_http_requests_total",
    "bba_http_request_duration_seconds",
    "bba_http_errors_total",
    "bba_dependency_ready",
    "bba_notification_delivery_total",
    "bba_worker_runs_total",
    "bba_worker_run_duration_seconds",
  ]) assert.match(metrics, new RegExp(metric));
  assert.match(http, /recordHttpError\(code, status\)/);
  assert.match(notifications, /recordNotificationDelivery/);
});

test("production metrics cannot silently become an anonymous endpoint", async () => {
  const server = await readFile(serverUrl, "utf8");
  assert.match(server, /NODE_ENV === "production" && !env\.METRICS_TOKEN/);
  assert.match(server, /METRICS_NOT_CONFIGURED/);
  assert.match(server, /Authorization|authorization/);
  assert.match(server, /Cache-Control/);
});

test("operational health tracks critical worker heartbeats without replacing readiness", async () => {
  const server = await readFile(serverUrl, "utf8");
  assert.match(server, /\/health\/ready/);
  assert.match(server, /\/health\/operational/);
  assert.match(server, /notificationDelivery.*2 \* 60_000/s);
  assert.match(server, /saasLifecycle.*10 \* 60_000/s);
  assert.match(server, /startWorkerRun\("notification_delivery"\)/);
  assert.match(server, /startWorkerRun\("saas_lifecycle"\)/);
  assert.match(server, /void runNotificationDeliveryWorker\(\)/);
  assert.match(server, /void reconcileCommercialLifecycle\(\)/);
});

test("external monitor is off-host, frequent, persistent and recovery-aware", async () => {
  const workflow = await readFile(uptimeUrl, "utf8");
  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /beingbrilliantedu\.com/);
  assert.match(workflow, /main-staging\.beingbrilliantedu\.com/);
  assert.match(workflow, /health\/ready/);
  assert.match(workflow, /health\/operational/);
  assert.match(workflow, /health\/integrations/);
  assert.match(workflow, /\[monitor\] Production health check failing/);
  assert.match(workflow, /issues\.create/);
  assert.match(workflow, /issues\.createComment/);
  assert.match(workflow, /state: "closed"/);
});

test("backup worker persists health markers and container exposes freshness health", async () => {
  const [backup, health, docker, compose] = await Promise.all([
    readFile(backupUrl, "utf8"),
    readFile(backupHealthUrl, "utf8"),
    readFile(backupDockerUrl, "utf8"),
    readFile(composeUrl, "utf8"),
  ]);
  assert.match(backup, /\.last-attempt/);
  assert.match(backup, /\.last-success/);
  assert.match(backup, /\.last-failure/);
  assert.match(health, /BACKUP_MAX_AGE_SECONDS/);
  assert.match(health, /SHA256SUMS/);
  assert.match(docker, /healthcheck\.sh/);
  assert.match(compose, /BACKUP_MAX_AGE_SECONDS/);
  assert.match(compose, /healthcheck\.sh/);
});

test("backup shell scripts remain syntactically valid", () => {
  for (const url of [backupUrl, backupHealthUrl, backupEntryUrl]) {
    execFileSync("sh", ["-n", fileURLToPath(url)], { stdio: "pipe" });
  }
});

test("monitoring and incident documentation preserve SLO, severity and Step 5 boundaries", async () => {
  const [monitoring, incident] = await Promise.all([
    readFile(monitoringUrl, "utf8"),
    readFile(incidentUrl, "utf8"),
  ]);
  assert.match(monitoring, /99\.5%/);
  assert.match(monitoring, /15 minutes/);
  assert.match(monitoring, /Step 13 does not close Step 5/);
  assert.match(monitoring, /Do not claim verified off-site disaster recovery/i);
  assert.match(incident, /P1 — Critical/);
  assert.match(incident, /P2 — High/);
  assert.match(incident, /tenant-isolation/i);
  assert.match(incident, /Never restore directly over production/i);
  assert.match(incident, /Post-incident review/);
});
