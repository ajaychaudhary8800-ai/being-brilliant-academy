# SchoolOS V5 — Phase 1 values-free deployed credential-scope classification

**Status:** Source-only diagnostic correction. No staging Docker host, container, image, secret, application, deployment or production resource was accessed or changed by this pull request.

## Why this correction matters

The existing `schoolos-v5-incident-readonly-scope.py` inspector reported `API_ONLY_RUNTIME_EXPOSURE=<KEY_NAME>` for a non-API container whenever Docker `Config.Env` contained the name **even if the value was empty** (`JWT_ACCESS_SECRET=`). Optional Compose / Coolify placeholders can be deliberately empty. A blank entry proves an environment key exists; it **does not** prove the service can use a secret. Reporting those blanks as a credential exposure exaggerates the evidence and can misdirect Phase 1 incident handling.

The revised logic checks **exact variable names and nonempty values**, without returning/printing/logging any value, hash, credential-derived fingerprint, URL, Docker ID or location. A duplicate env entry with at least one nonempty value is treated as exposed. Invalid Docker metadata fails closed. The stopped `migrate` service is explicitly included in the fixed seven-service inventory.

Additional API-only secrets whose values must never be exposed outside the API runtime are now tracked: `WEB_PUSH_PRIVATE_KEY`, `AWS_SECRET_ACCESS_KEY`, `METRICS_TOKEN`. Ordinary `DATABASE_URL` / `POSTGRES_PASSWORD` / `REDIS_PASSWORD` continue to be governed by **service-appropriate** connection scope and are not silently recategorized as API-exclusive. This is not a general secrets scanner.

## Run after owner-controlled read-only staging access is available

From a trusted, already-authorized staging VPS root terminal, on the exact known V5 Compose project `96ffcu0jinuwlnaqxpltln4p`, run **only**:

```bash
python3 scripts/schoolos-v5-incident-readonly-scope.py --read-only-staging-scope
```

It reads existing Docker labels, stopped/running container `Config.Env`, image metadata and history, but never prints raw data. It does not restart containers, build or execute cached images, read secret files or alter volumes. The output contains only the service role plus protected credential **names** and classifications. Never share raw `docker inspect`, `docker history --no-trunc`, `env`, `docker compose config` or credential files.

`STAGING_INCIDENT_SCOPE=PASS_READ_ONLY_COMPLETE` means the **inventory ran completely**, not that credentials have been contained. Evaluate each `API_ONLY_RUNTIME_EXPOSURE` line: `NONE` for six non-API services is necessary but not sufficient for release. `IMAGE_METADATA_EXPOSURE` is a **separate sensitive marker-name classification**; it is not a proof of nonempty live credentials or a full image-layer scan. If any unexpected name or invalid metadata appears, retain #281/#293 OPEN and `DEPLOYMENT_AUTHORIZATION=HOLD`.

## Tests and acceptance

The existing full repository CI discovers `scripts/test_schoolos_v5_*.py`. The expanded synthetic tests verify:
- Empty optional `KEY=` placeholders do not falsely signal a leaked runtime credential.
- Exact nonempty assignments are reported by **name only** (including key duplicates, Web Push, AWS and Metrics secrets).
- Substring and mixed-case unrelated variables do not produce false positives.
- A stopped migration service remains in scope.
- Malformed Docker metadata is rejected; actual values never appear in returned data.
- Existing image-history detection remains separate and is unchanged in scope.

This audit **cannot** prove old archive history secrets have been invalidated, previously deployed Web images sanitized, clean images published, signed prior API/Web OCI rollback artifacts recovered, Cloudflare R2 WORM custody, PostgreSQL/Redis credential rotation or an authorized staging maintenance handoff. Those require independent operator evidence and #258 human review. The phase formally remains **HOLD**, including #281/#292/#293 and all 10 launch gates.
