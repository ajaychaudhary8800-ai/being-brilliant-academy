# SchoolOS V5 — P0 #293 Credential-Exposure Containment and Coordinated Rotation

**Date:** 1 November 2026. **Control:** Staging-only, no V4 production changes, no Phase 2 UAT interruption. Commercial launch HOLD.

## Verified starting position (do not repeat already-passed tests)

- The old staging Web Docker image `history[].created_by` was observed to include sensitive `DATABASE_URL`, `POSTGRES_PASSWORD`, and `REDIS_PASSWORD` build arguments. This is exposure to people with image/archive access; no external misuse is established. Original archive/log access must be restricted.
- Issue #281 separately observed four unexpected nonempty API-only runtime credential entries in each of six non-API staging containers (including stopped migration), before corrected source reached staging. It is not proven that the current runtime was remediated.
- Source-only Phase 1 #300 (head `ee18edbaad43cdd3268525a54c4961308e57d15b`) passed exact-head CI #41278397546. The CI-built API/Web metadata guard detected no secret assignment in newly built images. It did not scan old images, filesystem layers or registry access.
- Owner-reported Vault recovery PASS: the original API-only protected key was stored as owner-local Windows CurrentUser DPAPI escrow and verified by an actual isolated `20261031T073407Z` checkpoint AES-256-GCM/tag/sha256 readback. Do not rotate this document-encryption key, JWTs, R2 or provider credentials on the basis of PostgreSQL/Redis exposure alone.
- Current staging seven-service Compose project: `96ffcu0jinuwlnaqxpltln4p`. Existing persistent staging volumes must be reused. Issue #292 still lacks a verified signed immutable previous API/Web rollback pair and backwards-compatible database path.

## Stage A — containment without changing running services

1. Restrict access to the already-exported API/Web image archive and original incident logs on the owner's BitLocker-protected Windows computer. Keep the preserved evidence in the existing restricted local recovery workspace, out of Downloads, OneDrive, chat, tickets and GitHub. Do not upload archives or raw `docker history`/image configuration anywhere. Record only retention custodian and masked asset inventory.
2. Restrict access to any staging-VPS image archive and Coolify build logs through existing approved access controls. Do not delete live Docker image IDs, prune Docker resources, remove volumes, edit service environment, stop containers, rotate credentials or redeploy during Phase 2. Record authorized registry/archive pull audience and whether any untrusted pull was observed; unknown is not proof of absence.
3. Run `scripts/schoolos-v5-incident-readonly-scope.py --read-only-staging-scope` **on the existing V5 VPS** under authorized root. The script reads only the Docker metadata/config/history for seven containers with the exact V5 Compose project label, and prints public **variable names only**. No values, IDs, paths, logs, image-history content, deployment or restarting. It does not inspect old exported archives or Docker layers. The owner returns the sanitized `SERVICE`, `API_ONLY_RUNTIME_EXPOSURE`, `IMAGE_METADATA_EXPOSURE`, and final flags.
4. Optionally run the separately source-reviewed owner-Windows `scripts/schoolos-v5-private-archive-secret-audit.py --archive <restricted old archive>` if the old TAR filename is locally known and authorization covers that restricted copy. It reads Docker-save JSON config only, no layers, no secret values printed; absence of metadata patterns cannot certify zero secret material anywhere in the image.
5. Do not treat a healthy staging service or green CI as credential-security clearance. On any unexpected scope or damaged history, mark `INCIDENT_CONTAINMENT=CHECK_REQUIRED` and keep Phase 2 staging lock and commercial HOLD.

## Stage B — secure replacement artifacts (independent of Phase 2)

1. Freeze and review a V5-only SHA; pin Docker build context and Dockerfile digest. Eliminate Coolify global build ARG injection of secrets; only nonsecret build arguments permitted. GitHub CI synthetic API/Web image metadata audit must return `PASS_METADATA_ONLY` (PR #300). Clean BuildKit output must be audited for secret-sensitive file payloads by a qualified authorized reviewer; CI metadata alone does not inspect filesystem layers or historical registry copies.
2. Produce immutable retrievable approved API/Web/backup images with exact source→build→OCI manifest mapping, registry access policy and durable protected copy. Sign or independently verify provenance according to release Gate 2; never reuse legacy `rc7` mutable tags to claim a clean rollback.
3. In an isolated local/CI environment, verify full API/Web startup and migration compatibility against a disposable copy of the actual backup. Use the already-passed full DB/files and Vault tests as prior evidence; run only new compatibility checks, not redundant recovery experiments. If DB down-migration is unsafe, document rollback by restore + forward-app recovery with RPO/RTO impact.

## Stage C — coordinated PostgreSQL + Redis credential rotation; NOT during Phase 2

**Hard prerequisites:** owner records Phase 2 UAT pause/release of shared staging; a documented maintenance window and expected outage are accepted; a current authenticated offsite recovery point and approved rollback pair are available; no unauthorized staging or production promotion is underway; nonsecret canary health and protected secret-file handoff are reviewed. If any gate fails, STOP before mutation.

1. Prepare new independent cryptographically strong PostgreSQL and Redis secrets in an authorized encrypted password manager or host protected secret store (never a command line, Git history, browser screenshot, CI secret, image ARG, task log or chat). Record custodian and backup coverage; prevent accidental alteration of Vault, JWT, Razorpay, LiveKit, SMTP or storage keys.
2. Map each dependency and setting **by name only**: PostgreSQL role/host/port, `POSTGRES_PASSWORD`, percent-encoded `DATABASE_URL`, backup and migration access, API DB access, Redis `REDIS_PASSWORD` and API `REDIS_URL`, Redis healthcheck and password-dependent readiness checks. A database password stored inside a URI needs correct percent-encoding; do not paste URI plaintext into an issue.
3. Quiesce V5 staging traffic/workers/backup schedule in the approved maintenance window using an explicit rollback plan. Never assume two password changes across Postgres, Redis, and clients are atomic. Stage new credential files with root ownership and 0600 permissions, and check exact service-only scope. Do not use Coolify global Build Arguments or a shared environment file.
4. Rotate the PostgreSQL role password through a restricted authenticated session with logging protection, and update all dependent clients in that same controlled window. Redis `requirepass` must be updated in a controlled step with its dependent API URL/healthcheck and persistent Redis volume preserved. Avoid `docker compose down -v`, image prune and raw `docker inspect` output.
5. Rebuild/redeploy only clean source-pinned V5 images, replace the affected **seven** running/stopped service containers if required for #281, keep explicit existing volume identities, then confirm nonsecret health, migrations, backup readability, Redis availability, log/error absence, and zero API-only runtime credentials in six non-API containers. Verify the old PostgreSQL and Redis passwords have been invalidated by controlled boolean-only negative authentication checks; do not print credentials or hashes.
6. Verify current Docker build history/config and image filesystem/layers against scoped P0 credential markers, registry access audience, clean image digests and rollback pair. Preserve old copies privately for approved forensics; delete or restrict affected published registry tags only after signed retention/legal and recovery decisions. Obtain owner-attributable security signoff and documented residual-risk approval.
7. Resume Phase 2 UAT only after the owner accepts actual deployment health, data/tenant isolation, signed exact image identity and planned downtime impact. No production/V4 or payment movement in this sequence. Run the actual launch acceptance gates separately.

## Stop/rollback criteria

- No approved non-disruptive window; Phase 2 active; rollback images or DB compatibility unverified; source-to-OCI provenance missing; untrusted image layer inspection; missing protected secrets; service mismatch; any negative auth/health/volume/backup check fails.
- **If stopped:** do not rotate, deploy or restart. If a rotation partially completed during authorized window, follow the separately reviewed protected credential rollback/restore procedure; never blindly reapply an old exposed secret or assume schema down-migration is reversible.

## Current evidence status

| Check | Status |
|---|---|
| Source tests and clean CI API/Web metadata veto | PASS |
| Owner-local Vault decryption and DPAPI custody | PASS (not offsite independent) |
| Live staging runtime and image history scope | PENDING owner read-only execution |
| Old archive / registry access containment | PENDING attributable restriction |
| Existing image layer / registry secret scan | NOT VERIFIED |
| Clean immutable signed replacement API/Web/backup artifacts and rollback | NOT VERIFIED |
| Coordinated PostgreSQL and Redis rotation | **NOT EXECUTED** (Phase 2 lock) |
| #281/#292/#293 formally closed | NO |
| Commercial release | HOLD |
