# SchoolOS V5 — Phase 1 artifact provenance and compatible recovery decision

**Status:** `EVIDENCE_MAPPING_PREPARED; TECHNICAL_GO=HOLD`  
**Scope:** V5 isolated staging Compose project `96ffcu0jinuwlnaqxpltln4p` only.  
**Selected current source:** `b54dca5ae36a948f83012faa4a37354198fba083`.  
**Owner direction:** Proceed with preparation/assessment, with no lock transfer until the stated requirements are actually evidenced.  
**Related:** #258 (authoritative), #292 (recovery), #293 (image-secret incident), draft PR #291.

## Accepted existing evidence — do not repeat

- Exact V5 source commit and clean four-image original-builder evidence exists; source-level Docker build argument protections and synthetic CI have passed. PR #291 exact-head `fa8df623200d3ac16b8246e6be06c52127c1bf8a` CI #41179907353 success; sandbox/external QA at that head skipped. CI is not signed provenance for Windows-built images.
- Four owner-local candidate image tags, original-builder external image-ID evidence, and transferred root-private TAR exist. TAR SHA-256: `bf956547d243d02bca7ea9a152147a4d6920e74b2c7cc90ab44f0fe61d6ea5ca`.
- A fresh `docker save` from the **same local tags** reproduced the four original TAR config digests; however, Docker Desktop `image inspect .Id` differs from the exported configuration digests for all four images. The cause is not independently established. **Do not overwrite the original manifest to hide this difference**.
- Exact ordered `RootFS.diff_ids` match between owner-local Docker image inspection and TAR: API 17, Web 10, Nginx 9, Backup 14. This demonstrates filesystem-layer identity at the uncompressed diff-ID level, not identical metadata or signed build provenance.
- Four image histories and final image-level environment metadata passed prior *limited* clean-image audit; separate bounded layer scans found application/dependency/test pattern candidates and certificate links. No conclusive live secret identified by those scans, but human security residual-risk acceptance remains needed. Do not repeat scans unless materially changed images or a specific security finding requires it.
- Current verified V5 DB/files offsite checkpoint `20261031T073407Z` and isolated older DB restore of 29 Oct exist. **Neither proves a same-version application+uploads+Vault/media recovery for the current checkpoint.**

## New, narrowly scoped identity bridge

The `schoolos_v5_artifact_identity_bridge.py` program compares **only the original builder manifest, Docker-save config objects, and the owner-local Docker Desktop image inspect objects**. It verifies:

1. Exact pinned TAR digest and four canonical saved image roles, config-content hashes and source labels (API/Web).
2. Original external builder image IDs correspond to the four **currently tagged local Docker images**, rather than incorrectly requiring exporter config digest equality.
3. Archive and local images have identical ordered RootFS diff-IDs, image OS/architecture, and selected runtime configuration fields (**Env, User, WorkingDir, Entrypoint, Cmd, ExposedPorts, Volumes, Labels, Healthcheck, StopSignal, Shell**). These are compared **in memory only**, without printing keys, values, history or paths.
4. Local engine is Windows Docker Desktop Linux through its named pipe, not a remote Docker socket. No image saves, builds, imports, deletions, pulls, container launches, staging connections, credentials or service changes occur.
5. An optional machine-readable local mapping is written as a separate file containing only immutable hashes, role and boolean result fields. **It deliberately sets independent provenance, import/restore and deployment approval to false**.

If runtime config differs, the script exits nonzero with a fixed reason code and does not generate a passing evidence file. Even a passing local mapping does **not** itself close source-to-build provenance. The selected runtime source label is self-asserted metadata; there is no trusted build signature on the saved TAR or a published immutable digest chain yet.

## Recoverability architecture — conditionally accepted, not exercised

**Preferred recovery path: same-version clean rollforward** using the exact V5 source with the existing compatible DB schema and preserved persistent volumes. Historical older-version image-only rollback is **not approved** because the required compatible previous API/Web pair has not been identified or independently retrieved (#292), and those older images may contain exposed secrets (#293).

**Source compatibility analysis:** A GitHub compare from `f736e64b0e1b332aabf20557025f10b3b602b97b` to selected `b54dca5ae36a948f83012faa4a37354198fba083` found no Prisma schema/migration changes. The runtime application changed the branch creation endpoint and UI to allow deferred Branch Administrator provisioning. A same-version clean rebuild of `b54dca5...` should preserve this feature at the source level. **This is not a tested application recovery or proof that arbitrary older code can read post-change records.** If Phase 2 PR #290 code is incorporated in a later source, this assessment must be explicitly reevaluated.

**Persistent state/recovery scope:** `postgres_data`, `redis_data`, `app_storage`, `backups` external V5 volumes; protected API-only runtime credentials/keys; PostgreSQL 114 previously applied migrations; backups/checksums and Cloudflare R2; Vault document decryption keys; recorded LiveKit assets and any external object-store references; webhook/payment event idempotency and external provider state. **Redis cache/session implications and historical media references are not proven by the DB backup alone.**

**Failure-handling sequence, only within a separately approved V5 maintenance window:**

1. Stop new synthetic staging writes and backup/cron overlap under operator-controlled maintenance lock; preserve server/Compose/volume identities; capture checksum/health/tenant baseline and an independent recent recovery point. No `docker compose down -v`, prune, unreviewed pull or DB downgrade.
2. Verify a private, independently retrievable same-source clean image set by immutable subject digests, including a trusted source/build-argument/runner/BuildKit manifest and human review. Verify image import/inspection in an **isolated disposable engine**, without colliding with production or shared V5 tags. Accept only after metadata, compatibility and credentials review, not merely a successful import.
3. Validate recoverability in isolation from a coherent checkpoint: database/migrations, nonempty upload if one exists, application media reference integrity, protected Vault key custody/decrypt sample if authorized, offsite backup restoration and recordings. Explicitly select/record **RPO** (data loss tolerance) and **RTO** (service restoration target) rather than inventing values.
4. List all PostgreSQL and Redis credential consumers: postgres service and persisted DB role, Redis auth/command/healthcheck, API `DATABASE_URL`/`REDIS_URL`, backup database URL, stopped migrate service, secret-mounted API, monitoring/cron. Rotation must be staged and coordinated; merely replacing Compose `POSTGRES_PASSWORD` on an existing persistent cluster is insufficient to change the DB role password. **Never blindly rotate JWT, Vault encryption, payment, LiveKit or email keys.**
5. Only after Phase 2 explicitly releases the V5 staging lock on Issue #258, have the owner approve dated maintenance window, expected image and Compose digests, command/recovery operator, abort conditions and contingency.
6. On error, freeze new writes and **do not automatically revert to an older application**. Preserve evidence; if clean same-version redeployment cannot be restored, carry out preapproved isolated DB+uploads+keys+media recovery and verify tenant/auth/backup integrity before changing V5 traffic. Rollforward/restore RPO and RTO must be approved.
7. Post-change acceptance must include real staged new/old DB credential authentication results, no unauthorized non-API secrets, current revision+image pin, all six service health, tenant isolation, branch admin synthetic flow, backup freshness and offsite access, external media references and alert delivery. Reuse unaffected earlier tests.

## Evidence/decision register

| Decision | Current status | Cannot be asserted until |
|---|---|---|
| TAR transfer and SHA | **EVIDENCED** | Previously checked; no repeat necessary |
| Local archive filesystem-layer parity | **EVIDENCED** | Previously checked for 4/4 roles |
| Original-builder-ID to saved-config-ID mapping | **CONDITIONAL** | New narrow bridge report and independent review of any config drift |
| Trusted source→build→immutable artifact provenance | **HOLD** | Authenticated independent builder/subject mapping or verified independently reproducible exact-source build with review |
| Real image import+app same-version recovery | **HOLD** | Disposable isolated restoration proof of actual clean artifact and state |
| Full DB+files+Vault/media recovery compatibility | **HOLD** | Coherent-point restore/authorized representative content or documented scope exception + human signoff |
| Previous-version image rollback | **NOT AVAILABLE / UNSAFE TO CLAIM** | Approved compatible previous binaries and state migration, or explicit rollforward-only recovery acceptance |
| Phase 2 shared staging lock release | **NOT PERFORMED** | Explicit exclusive release entry in #258 |
| Staging deployment/credential rotation | **NOT AUTHORIZED** | Above conditions, reviewer approval, dated window |
| Commercial release gates | **0/10 VERIFIED** | Independent gate-specific original evidence, separate from this technical review |

**Security/operations decision:** Owner direction for the conditional recovery *strategy* was received, but technical provenance approval and recovery compatibility remain **HOLD** until required evidence exists. Do not manufacture signatures or closure. No V4 production action.