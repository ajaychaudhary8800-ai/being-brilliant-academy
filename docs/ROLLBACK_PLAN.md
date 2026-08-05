# Production rollback plan

## Trigger

Rollback for failed readiness, authentication/authorization regression, tenant leakage, payment corruption, sustained error-rate increase, or an unrecoverable migration failure. Freeze writes before database rollback.

## Application rollback

1. Record current image digests and logs.
2. Set `API_IMAGE` and `WEB_IMAGE` to the last known-good immutable tags.
3. Run `docker compose --env-file .env.production up -d --wait api web nginx`.
4. Verify readiness, login, tenant isolation, payment webhook validation, and critical dashboards.

## Database rollback

Prisma production migrations are forward-only. Prefer a corrective migration when data remains compatible. If restoration is required, stop all writers, preserve the failed database separately, verify the selected backup checksum, and run `restore.sh` against an isolated database first. After validation, restore the production database and file archive together, deploy the matching application images, and reconcile external payments received after the backup timestamp.

## Communications

Notify operations, finance, and support of the incident window and possible delayed provider deliveries. Do not replay webhooks or queued notifications until idempotency and database state are confirmed. Record cause, recovery point, recovery time, and corrective actions.

