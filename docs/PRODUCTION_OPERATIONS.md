# Production operations runbook

## Operating model

Version 2.0 production is deployed through Coolify. The GitHub SSH deployment job remains available for a future migration, but it is disabled unless the repository variable `PRODUCTION_DEPLOY_ENABLED=true` is set.

Production changes must enter `main` through a pull request and pass the required `verify` and `containers` checks.

## Automated controls

### Nightly staging QA

`.github/workflows/nightly-e2e.yml` runs at 03:00 Asia/Kolkata and exercises the seven-role staging workflow, public portal selector, academic workflow, LMS, homework, attendance, messaging, and related smoke paths. Evidence is retained as workflow artifacts for 14 days.

### External uptime monitoring

`.github/workflows/uptime-monitor.yml` checks production and staging every 30 minutes.

A healthy response must report:

- `status=ready`
- `checks.database=true`
- `checks.redis=true`

When a check fails, the workflow opens or updates one GitHub incident issue per environment. When health recovers, the workflow comments on and closes the incident automatically.

### Backup

The backup service creates a PostgreSQL custom-format dump and file-storage archive, records SHA-256 checksums, removes backups older than the configured retention window, and can copy backups to S3-compatible storage when `BACKUP_S3_BUCKET` is configured.

Default schedule: `0 2 * * *` in the backup container timezone.

## Daily operator checks

1. Confirm production and staging uptime-monitor runs are green.
2. Check the latest nightly staging QA result.
3. Confirm a new backup directory exists and `SHA256SUMS` verifies.
4. Check Coolify for unhealthy or restarting containers.
5. Review new uptime incident issues and application errors.
6. Check disk usage and backup retention.

## Weekly checks

1. Review failed GitHub Actions runs and unresolved incident issues.
2. Confirm backup growth and available disk space.
3. Review authentication/rate-limit anomalies and provider delivery failures.
4. Review dependency and security alerts.

## Quarterly restore drill

Restore the latest backup to an isolated environment. Verify the checksum first, restore PostgreSQL and file storage, start the isolated application, then validate login and representative student, teacher, and admin records. Never test a restore against the live production database.

## Incident priority

- P1: production unavailable, database unavailable, tenant-isolation or security incident.
- P2: major module unavailable or persistent login failure.
- P3: isolated workflow defect with a workaround.

For P1, stop non-essential deployments, preserve logs, verify backup state, identify the last healthy release, and use the tagged release/rollback procedure if needed.
