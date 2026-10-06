# Production operations runbook

## Operating model

Version 2.0 production is deployed through Coolify. The GitHub SSH deployment job remains available for a future migration, but it is disabled unless the repository variable `PRODUCTION_DEPLOY_ENABLED=true` is set.

Production changes must enter `main` through a pull request and pass the required `verify` and `containers` checks.

### Public legal publication switch

Privacy, SaaS Terms and Acceptable Use routes are intentionally fail-closed. Keep `LEGAL_PAGES_PUBLISHED=false` until Indian counsel approves the controlled pack. After approval, set `LEGAL_EFFECTIVE_DATE` to the approved public effective date and set `LEGAL_PAGES_PUBLISHED=true` first in staging. Verify `/privacy`, `/terms`, `/acceptable-use`, footer links and the demo-form privacy link before applying the same settings to production.

## Automated controls

### Nightly staging QA

`.github/workflows/nightly-e2e.yml` runs at 03:00 Asia/Kolkata and exercises the seven-role staging workflow, public portal selector, academic workflow, LMS, homework, attendance, messaging, and related smoke paths. Evidence is retained as workflow artifacts for 14 days.

### External uptime monitoring

`.github/workflows/uptime-monitor.yml` checks production and staging every 15 minutes from off-host GitHub runners.

A healthy response must report:

- `status=ready`
- `checks.database=true`
- `checks.redis=true`

When a check fails, the workflow opens or updates a persistent `[monitor]` GitHub incident issue and the workflow remains failed for normal Actions notifications. Recovery is recorded automatically and closes the monitoring issue.

### Backup

The backup service creates a PostgreSQL custom-format dump and file-storage archive, records SHA-256 checksums, removes backups older than the configured retention window, and can copy backups to S3-compatible storage when `BACKUP_S3_BUCKET` is configured.

Default schedule: `0 2 * * *` in the backup container timezone.

## Daily operator checks

1. Confirm production and staging uptime-monitor runs are green.
2. Check the latest nightly staging QA result.
3. Confirm the backup container is healthy, a recent backup exists, and `SHA256SUMS` verifies.
4. Check Coolify for unhealthy or restarting containers.
5. Review failed uptime-monitor runs and application errors.
6. Check disk usage and backup retention.

## Weekly checks

1. Review failed GitHub Actions runs and unresolved operational issues.
2. Confirm backup growth and available disk space.
3. Review authentication/rate-limit anomalies and provider delivery failures.
4. Review dependency and security alerts.

## Quarterly restore drill

Restore the latest backup to an isolated environment. Verify the checksum first, restore PostgreSQL and file storage, start the isolated application when a full application recovery rehearsal is in scope, and validate representative student, teacher, parent and admin records. Never test a restore against the live production database.

Latest verified launch-readiness drill: **6 October 2026**. The production Cloudflare R2 copy was retrieved, both backup artifacts passed SHA-256 verification, PostgreSQL and file storage were restored into temporary isolated targets, representative role data was validated, and the temporary environment was removed afterward. The measured core database + file restore duration for the tested backup was **7 seconds**. See `docs/DR_RESTORE_EVIDENCE_2026-10-06.md`.

The measured drill result is operational evidence only and is not a contractual RPO/RTO promise.

## Incident priority

- P1: production unavailable, database unavailable, tenant-isolation or security incident.
- P2: major module unavailable or persistent login failure.
- P3: isolated workflow defect with a workaround.

For P1, stop non-essential deployments, preserve logs, verify backup state, identify the last healthy release, and use the tagged release/rollback procedure if needed.


## Advanced monitoring references

- `docs/MONITORING.md` — monitoring layers, active metrics, operational objectives and alert thresholds.
- `docs/INCIDENT_RESPONSE.md` — P1/P2/P3 triage, rollback, data/security incident handling and recovery criteria.
- `/health/operational` — dependency plus critical background-worker heartbeat health.
- `/metrics` — Prometheus telemetry. Production access requires `METRICS_TOKEN`; without it the endpoint intentionally returns `METRICS_NOT_CONFIGURED`.

The backup container tracks success/failure/freshness and reports unhealthy when the configured backup job fails or becomes stale. Monitoring alone does not prove recoverability; the separate isolated restore evidence must remain current and repeatable.
