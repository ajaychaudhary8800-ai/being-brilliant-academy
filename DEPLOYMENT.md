# Production deployment

## Prerequisites

- Linux host with Docker Engine and Docker Compose v2
- DNS record for `APP_DOMAIN` pointing at the host
- Ports 80 and 443 open
- At least 4 CPU cores, 8 GB RAM, and persistent disk sized for database, uploads, metrics, and backups

## First deployment

1. Copy `.env.production.example` to `.env.production` and replace every placeholder with a generated secret. Never commit this file.
2. Put a trusted certificate and private key into the `tls_certs` Docker volume as `fullchain.pem` and `privkey.pem`. If absent, `cert-init` creates a temporary self-signed certificate so the stack can boot; replace it before public use.
3. Run `docker compose --env-file .env.production config --quiet`.
4. Run `docker compose --env-file .env.production build api web backup`.
5. Run `docker compose --env-file .env.production up -d --wait`.
6. Verify `https://$APP_DOMAIN/health/nginx`, `/api/health/live`, and `/api/health/ready`. Prometheus reaches the non-public `/metrics` endpoint over the internal network.

The one-shot `migrate` service runs `prisma migrate deploy` before API startup. PostgreSQL and Redis are internal-only. Nginx is the only public service. Grafana is exposed at `/grafana/` and must use a strong administrator password.

## Secrets and storage

Production values are supplied through the protected host environment or CI environment secrets. Rotate database, Redis, JWT, Grafana, cloud storage, payment, and SMTP credentials on a schedule. `STORAGE_DRIVER=s3` enables S3-compatible object storage; set `AWS_S3_ENDPOINT` for MinIO or another compatible provider. `local` uses the persistent `app_storage` volume.

Docker's `json-file` driver rotates API, proxy, and infrastructure logs at 10 MB with five retained files. Central log shipping can consume Docker logs without changing application code; Pino emits structured JSON and redacts authentication data.

## Monitoring

Prometheus retains 30 days of API, PostgreSQL, Redis, process, and uptime metrics. Grafana automatically provisions the BBA Production Overview dashboard. Configure an external alert receiver/uptime service for off-host notification because an on-host monitor cannot report a total host outage.

## Backup and restore

The backup service runs nightly by default, creates a custom-format PostgreSQL dump plus an upload archive, records SHA-256 checksums, and removes backups older than `BACKUP_RETENTION_DAYS`. Set `BACKUP_S3_BUCKET` for off-site copies.

List backups with `docker compose exec backup ls -la /backups`. Restore during a maintenance window with `docker compose stop api web`, then `docker compose exec backup restore.sh /backups/TIMESTAMP`, then `docker compose up -d --wait`. Test restore procedures regularly on an isolated database.

## CI/CD secrets

Configure the protected GitHub `production` environment with `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, and `GHCR_DEPLOY_TOKEN`. The host checkout lives at `/opt/bba` with its protected `.env`/`.env.production`. Pull requests execute migration, TypeScript, production build, runtime health, Compose, and image build gates. Version tags publish both images to GHCR and run a rolling Compose deployment.

## Operational commands

- Logs: `docker compose logs -f --tail=200 api nginx`
- Status: `docker compose ps`
- Readiness: `curl -fk https://localhost/api/health/ready`
- Update: `docker compose pull && docker compose up -d --wait --remove-orphans`
- Stop without deleting data: `docker compose down`

Never use `docker compose down -v` in production unless permanently destroying all database, Redis, upload, monitoring, and backup volumes is explicitly intended.
