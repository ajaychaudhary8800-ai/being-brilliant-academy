# Advanced Production Monitoring

**Effective:** 25 September 2026
**Scope:** Being Brilliant ERP + LMS + CRM production and staging operations.

## 1. Monitoring layers

The platform uses layered monitoring so a single green signal is never treated as proof that the whole service is healthy.

### Layer A — External availability

`.github/workflows/uptime-monitor.yml` runs every 15 minutes from GitHub-hosted infrastructure.

For production and staging it checks:

- public homepage returns HTTP 2xx;
- homepage responds within the operational 8-second ceiling;
- database readiness;
- Redis readiness;
- notification-delivery worker heartbeat;
- SaaS subscription-lifecycle worker heartbeat;
- SMTP reachability when SMTP is configured.

A failed run opens or updates a persistent GitHub incident issue. A later healthy run records recovery and closes the issue.

This is deliberately off-host: a VPS/network failure cannot suppress the monitor itself.

### Layer B — Application metrics

`/metrics` exposes Prometheus-format telemetry including:

- Node/process default metrics prefixed `bba_`;
- `bba_http_requests_total`;
- `bba_http_request_duration_seconds`;
- `bba_http_errors_total`;
- `bba_dependency_ready`;
- `bba_notification_delivery_total`;
- `bba_worker_runs_total`;
- `bba_worker_run_duration_seconds`.

Production metrics are never intentionally anonymous. When `NODE_ENV=production`, `/metrics` returns `503 METRICS_NOT_CONFIGURED` unless `METRICS_TOKEN` exists, and requires `Authorization: Bearer <METRICS_TOKEN>` when configured.

Do not put `METRICS_TOKEN` into browser code or public documentation.

### Layer C — Background operations

`/health/operational` checks:

- database;
- Redis;
- notification-delivery worker heartbeat;
- SaaS commercial-lifecycle worker heartbeat.

Operational health is separate from container readiness so a transient background-worker degradation generates an alert without forcing an unhealthy restart loop.

### Layer D — Backup health

The backup worker records `/backups/.last-attempt`, `/backups/.last-success`, and `/backups/.last-failure`.

The backup container healthcheck fails when:

- the most recent backup attempt failed;
- the success marker points to an incomplete backup;
- no successful backup exists after the startup grace window;
- the last successful backup is older than `BACKUP_MAX_AGE_SECONDS` (default 108000 seconds / 30 hours).

A successful optional S3 copy is part of the backup job when `BACKUP_S3_BUCKET` is configured. This healthcheck does not mean Step 5 off-site DR is complete; it only verifies the configured backup job.

### Layer E — Functional QA

`.github/workflows/nightly-e2e.yml` executes the seven-role staging smoke/workflow suite daily at 03:00 Asia/Kolkata and retains QA evidence for 14 days.

### Layer F — Structured logs

API logging uses request IDs. Error responses include a `requestId`, and server logs include the same ID for correlation.

Container logs use bounded JSON-file rotation in Compose.

## 2. Operational objectives

The standard commercial availability objective remains **99.5% per calendar month** as defined by the SLA.

| Signal | Healthy operating target |
| --- | --- |
| External homepage | HTTP 2xx |
| External page response | <= 8s hard monitor ceiling |
| Database / Redis | ready |
| Notification worker | successful heartbeat within 2 minutes |
| SaaS lifecycle worker | successful heartbeat within 10 minutes |
| Backup freshness | successful configured backup within 30 hours |
| Nightly staging QA | green |
| SMTP | reachable when configured |

The 8-second monitor ceiling is an outage/degradation detector, not a normal UX performance target.

When a metrics collector/dashboard is attached, initial alert-review thresholds should be:

- HTTP 5xx ratio >5% for 5 minutes: P2 investigation;
- p95 API latency >2 seconds for 15 minutes on normal application routes: P2 investigation;
- sustained 401/403/429 spikes materially above baseline: security/abuse review;
- notification DEAD_LETTER growth: P2 provider/workflow review;
- repeated worker failures: P2;
- process memory/CPU saturation: capacity investigation.

These thresholds should be tuned using real production baselines after customer traffic exists.

## 3. Alert channels

Current active alert paths:

1. GitHub Actions failed-run notification.
2. Persistent GitHub monitoring incident issue for external health failures.
3. Coolify/Docker container-health visibility, including backup health.
4. Nightly QA failure evidence.
5. Structured application logs and request IDs.

Optional future integrations may forward metrics/logs to a dedicated observability vendor, but no unconfigured vendor is represented as active.

## 4. Useful Prometheus queries

5xx ratio:

    sum(rate(bba_http_requests_total{status=~"5.."}[5m])) / sum(rate(bba_http_requests_total[5m]))

API p95:

    histogram_quantile(0.95, sum by (le) (rate(bba_http_request_duration_seconds_bucket[15m])))

Worker failures:

    sum by (worker) (increase(bba_worker_runs_total{outcome="failure"}[15m]))

HTTP error codes:

    sum by (code, status) (increase(bba_http_errors_total[15m]))

Notification failures:

    sum by (channel, status) (increase(bba_notification_delivery_total{status=~"FAILED|DEAD_LETTER"}[30m]))

## 5. Monitoring ownership

Daily:
- review unresolved `[monitor]` issues;
- review latest external monitor state;
- review latest nightly QA;
- review backup container health / latest backup marker;
- review unexpected application errors.

Weekly:
- review 5xx and latency trends when a metrics collector is available;
- review authentication/rate-limit anomalies;
- review notification failures/dead letters;
- review resource saturation;
- review dependency/security alerts;
- review backup storage growth.

After every material deployment:
- verify production readiness;
- verify operational health;
- verify homepage;
- smoke login and one representative protected workflow;
- confirm no new persistent monitoring incident.

## 6. Boundaries

Step 13 does not close Step 5.

Do not claim verified off-site disaster recovery, contractual RPO/RTO, cross-region failover, or an external observability vendor integration unless separately implemented and verified.
