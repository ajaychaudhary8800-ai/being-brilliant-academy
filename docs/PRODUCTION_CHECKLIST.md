# Production deployment checklist

## Before deployment

- [ ] Release reviewed and tagged; CI typecheck, build, migration, and container jobs pass.
- [ ] `.env.production` contains unique database, Redis, JWT, metrics, Grafana, payment, mail/provider, storage, CRM, push, and WhatsApp values.
- [ ] DNS resolves to the host and trusted TLS certificate is installed.
- [ ] Off-site database and file backup completed and checksum verified.
- [ ] Migration reviewed for locks, destructive statements, and rollback implications.
- [ ] Payment webhook URL and signing secret verified in provider dashboard.
- [ ] Email/WhatsApp/SMS workers tested with non-production recipients.

## Deploy

- [ ] `docker compose --env-file .env.production config --quiet`
- [ ] Pull immutable tagged images.
- [ ] Run migration service and confirm exit code zero.
- [ ] `docker compose --env-file .env.production up -d --wait --remove-orphans`
- [ ] Verify Nginx, API liveness/readiness, public home, login, and one role dashboard.

## After deployment

- [ ] Confirm tenant isolation with accounts from two organizations.
- [ ] Confirm logs contain no secrets and metrics are being scraped.
- [ ] Run payment test-mode order/webhook and provider delivery smoke tests.
- [ ] Check sitemap, robots, canonical URL, structured data, and Lighthouse.
- [ ] Record image digests, migration version, operator, timestamp, and rollback deadline.

