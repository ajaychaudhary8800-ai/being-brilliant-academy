# Off-site Backup & Disaster Recovery

## Scope

Production creates a PostgreSQL custom-format dump plus the uploaded-file storage archive. Each backup carries SHA-256 checksums. Local and off-site retention are independent.

Recommended production policy:

- Local retention: 14 days.
- Cloudflare R2 retention: 30 days.
- Backup schedule: daily.
- Restore drill: monthly after launch; quarterly is the minimum fallback.
- RPO/RTO must be recorded from measured tests, not assumptions.

## Cloudflare R2

Create a dedicated private bucket, for example `bba-production-backups`. Create the long-lived backup S3 credential with **Object Read & Write** permission scoped only to that bucket. Do not give the backup service administrative bucket permissions.

Set these production environment values in Coolify:

```
BACKUP_S3_BUCKET=bba-production-backups
BACKUP_S3_PREFIX=backups
BACKUP_S3_RETENTION_DAYS=30
AWS_S3_ENDPOINT=https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com
AWS_REGION=auto
AWS_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
AWS_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
```

Do not store real credentials in Git. After changing the environment, redeploy/recreate the backup service so it receives the new values.

## Configure and verify off-site retention

Configure the lifecycle rule in the Cloudflare R2 bucket **Settings → Object lifecycle rules** using prefix `backups/` and expiration after 30 days. This is a bucket-level administrative action and should not be performed with the long-lived Object Read & Write backup credential.

If an administrator deliberately uses a separate temporary/admin S3 credential, `/usr/local/bin/configure-retention.sh` can configure and read back the same lifecycle rule. Revoke or remove that administrative credential immediately after the one-off configuration; do not save it in the production backup service.

Retention verification evidence is the lifecycle rule shown in R2 settings (or a successful read-back using the separate administrative credential), with rule ID `bba-backup-retention`, prefix `backups/`, and the configured expiration days.

## Manual backup and upload test

Inside the backup container:

```sh
/usr/local/bin/backup.sh
latest="$(ls -1dt /backups/* | head -1)"
stamp="$(basename "$latest")"
sha256sum -c "$latest/SHA256SUMS"
/usr/local/bin/verify-offsite.sh "$stamp"
```

Pass criteria: local database and files checksums report `OK`, followed by `Off-site upload verified` and `Off-site backup verified`.

## Scheduled upload test

Leave the configured cron schedule enabled. After the next scheduled run:

```sh
latest="$(ls -1dt /backups/* | head -1)"
stamp="$(basename "$latest")"
/usr/local/bin/verify-offsite.sh "$stamp"
```

Record the timestamp and result in the DR evidence log.

## Isolated restore drill

Never restore a drill into the production database or production file-storage path.

Provision an isolated PostgreSQL database and isolated storage path, then run:

```sh
export RESTORE_DATABASE_URL='postgresql://.../bba_restore_drill'
export RESTORE_STORAGE_PATH='/restore-drill/storage'
/usr/local/bin/restore-from-s3.sh <TIMESTAMP>
```

The restore script refuses to target the normal `DATABASE_URL` unless `RESTORE_ALLOW_PRODUCTION=true` is deliberately set for genuine disaster recovery.

The output records `restore_elapsed_seconds`, `restored_public_tables`, and `restored_files`. After data restore, start an isolated application instance and verify: health, Super Admin login, organization/branch data, teacher/student/parent data, LMS content, and at least one uploaded document/image.

## RPO and RTO

Set formal numbers only after the first successful drill:

- Measured RPO: age of the newest successfully restorable off-site backup at drill start.
- Measured RTO: elapsed time from restore start until the isolated application passes the smoke test.

Record backup timestamp, restore start/end timestamps, database size, storage size, Git SHA, operator, measured RPO, and measured RTO.

## DR evidence log

| Drill date | Backup timestamp | Off-site checksum | Retention | Restore seconds | App smoke | Measured RPO | Measured RTO | Notes |
|---|---|---|---|---:|---|---|---|---|
| pending | pending | pending | pending | pending | pending | pending | pending | Initial R2 drill |

## Exit criterion

Step 5 is complete only when: local backup verifies; off-site R2 backup verifies; lifecycle retention is read back successfully; a scheduled backup verifies off-site; an isolated restore succeeds; restored application/data smoke succeeds; actual restore time is recorded; and RPO/RTO are recorded from that drill.
