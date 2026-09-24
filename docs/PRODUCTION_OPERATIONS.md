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

When a check fails, the scheduled workflow fails and is visible in GitHub Actions. Configure GitHub Actions failure notifications for off-host alert delivery.

### Backup

The backup service creates a PostgreSQL custom-format dump and file-storage archive, records SHA-256 checksums, removes local backups older than the configured retention window, and copies backups to S3-compatible off-site storage when `BACKUP_S3_BUCKET` is configured.

For Cloudflare R2 use `AWS_REGION=auto` and the account-specific R2 S3 endpoint. Remote lifecycle retention is configured with `/usr/local/bin/configure-retention.sh`. See `docs/BACKUP_DR.md` for verification and isolated restore procedures.

Default schedule: `0 2 * * *` in the backup container timezone.

## Daily operator checks

1. Confirm production and staging uptime-monitor runs are green.
2. Check the latest nightly staging QA result.
3. Confirm a new backup directory exists and `SHA256SUMS` verifies.
4. Confirm the newest scheduled backup also verifies from off-site storage.
5. Check Coolify for unhealthy or restarting containers.
6. Review failed uptime-monitor runs and application errors.
7. Check disk usage and backup retention.

## Weekly checks

1. Review failed GitHub Actions runs and unresolved operational issues.
2. Confirm backup growth and available disk space.
3. Review authentication/rate-limit anomalies and provider delivery failures.
4. Review dependency and security alerts.

## Monthly restore drill

Restore the latest off-site backup to an isolated environment. Verify the checksum first, restore PostgreSQL and file storage, start the isolated application, then validate login and representative student, teacher, parent, and admin records. Never test a restore against the live production database.

Record measured RPO and RTO from the completed drill.

## Incident priority

- P1: production unavailable, database unavailable, tenant-isolation or security incident.
- P2: major module unavailable or persistent login failure.
- P3: isolated workflow defect with a workaround.

For P1, stop non-essential deployments, preserve logs, verify backup state, identify the last healthy release, and use the tagged release/rollback procedure if needed.
