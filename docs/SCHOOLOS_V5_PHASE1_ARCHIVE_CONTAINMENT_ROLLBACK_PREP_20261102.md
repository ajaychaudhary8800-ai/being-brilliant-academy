# SchoolOS V5 Phase 1 — Historical credential containment and immutable rollback preparation

**Checkpoint:** 2 November 2026. **Authority:** V5 staging only. Phase 2 retains shared staging; no VPS mutation, no production change, no password rotation, no public artifact copies. Gate 10/commercial GO = HOLD.

## Confirmed incident / safe evidence (do not retest)

- A previously exported staging Web image has **nonempty PostgreSQL and Redis credentials in Docker build-history metadata** (#293). Treat any holder of the affected custom-image archives/registry artifacts as potentially able to read them. There is no evidence of exploitation, but unverified access is NOT proof of no access.
- The initial live helper reported **assignment names** in 6 non-API runtime environments. Two later owner-run **nonempty-only** Docker Config.Env checks across the exact same 6 services and 12 API-only variable names each returned `NONE` for all services. The current twelve-key scoped runtime finding is clear; this does **not** erase the older historical four-nonempty observation or inspect fields beyond those 12.
- The live five custom-service image histories contain sensitive variable *names* (not necessarily nonempty values). The Web archive independently confirms genuine Postgres/Redis secrets. Raw Docker history, `Config.Env`, archive metadata and provider keys must NOT be attached to GitHub or ChatGPT.
- GitHub source-pinned synthetic CI-built API/Web metadata audit passed Draft #300, **but old deployed images, exported archive layers, registry audiences, signature chain, backwards DB compatibility and retrievable rollback pair are NOT verified**.
- The owner already proved real single-record Commercial Vault AES-GCM decrypt plus checksum and Windows CurrentUser DPAPI local custody from the actual recovered checkpoint. Retain this evidence; do not rotate the Vault key. Independent offsite key escrow remains unverified.

## A. Contain archived credentials now — permitted without touching Phase 2

1. Inventory the **existing** archive locations in the owner-restricted BitLocker recovery directory, VPS-restricted backup directory, Coolify build logs, and any artifact registry. Record only categories/counts, custodian, retention, user-access approval and **offline private evidence references**, not public filenames, registry credentials, full paths, raw Docker history, image configuration, digests of passwords or customer content.
2. Locally secure any *existing exported archive* and unredacted incident log: authorized owner-only encrypted storage, no cloud sync/public shares, limited forensic access, retained immutable original and private access log. Do **not** delete archives or move live Docker images while restore/rollback needs are unresolved. A source PR cannot assert these ACLs have been applied on user machines.
3. For VPS registry and build-log access, enforce actual least-privilege only after checking which principals need emergency rollback. Rotate/revoke access tokens **only** through separately approved authorized scopes; do not disrupt Phase 2 deploy channels. Preserve minimal restricted incident forensics, and document who *could* pull the affected images during exposure window. If audience/retention is unknown, classify as `AUDIENCE=UNVERIFIED`.
4. Prevent future image leakage: V5 source Dockerfiles must accept only non-sensitive build args; protected app/provider settings must load at **runtime**, API-only, from the reviewed mount files. CI metadata guard already checks freshly built images, but **filesystem layer** and source-to-build attestation gates are separate. Do not confuse source scans with rewriting the old image history.
5. Historical compromised PostgreSQL/Redis credentials cannot be called contained until the authorized rotation and post-rotation invalidation have happened. Passwords exposed in old image archives remain risky until invalidated even if archive ACLs improve.

## B. Prepare a rollback pair without staging interruption

### Required candidate bundle

- One **pinned source revision** covering reviewed V5 API/Web/backup Docker contexts, Compose, dependencies and migrations; record complete source SHA. Never promote a mutable `rc7` tag based solely on a label.
- Three **immutable retrievable OCI objects**, one per `api`, `web`, `backup`. Record each digest, independent source→build→OCI attestation and restricted storage locator. Do not copy credentials into build args, Docker cache, labels, image config, CI logs or filesystem layers.
- Independent metadata **and full-layer** secret scan receipts for all three images, using no real secrets in CI; `PASS_METADATA_ONLY` is insufficient. Only bounded, source-pinned artifacts may be nominated.
- Isolated **actual application** API/Web startup against a disposable restored data set, previously passed Vault/decryption evidence reused as-is. Verify both **forward and backward schema/data compatibility** or explicitly choose controlled **restore + forward-app recovery**. Never assume Prisma down-migrations are available.
- Confirm exact existing external named volumes for Postgres, Redis, uploads, backups, read-only mounts; note initial `CACHED_PREVIOUS_IMAGE_PAIRS=0` under the tested legacy label/workdir matching policy (#292). A freshly built candidate is not a validated *previous* rollback image.
- Establish cold-start and restore RPO/RTO expectations, checks for health and protected secrets handoff; emergency rollback requires a **recoverable** complete target, not just hashes or tar files.

### Policy gate (independent source utility)

`scripts/schoolos-v5-phase1-rollback-evidence-gate.py --sanitized-index <approved-private-index.json>` validates the public-field checklist in the separately prepared index. It accepts only exact expected fields, 40-hex source SHA, immutable 64-hex image digests and receipt identifiers of the form `EVIDENCE-...`; it never opens the referenced private evidence files and never prints sensitive values. `PASS_DECLARATIONS_ONLY` means the declared checklist is complete, **NOT** that a signature, registry digest or restore was cryptographically verified. It ALWAYS emits `DEPLOYMENT_AUTHORIZATION=HOLD`. A named human reviewer must authenticate all underlying source records.

The index must contain: `schema`, `staging_project`, `candidate_source_sha`, `images`, `controls`, `phase2_release`, `rotation_window`. `images` is exactly `api`, `web`, `backup`, each with `image_digest`, `source_sha`, and `metadata_audit`, `full_layer_audit`, `immutable_copy_retrieval`, `source_to_image_attestation`, `isolated_app_boot`. Every receipt is `{ "result": "PENDING|PASS|FAIL", "ref": "EVIDENCE-<sanitized-id>" }`. `controls` must include `archive_access_restricted`, `registry_pull_audience_reviewed`, `legacy_artifacts_retained_under_forensic_hold`, `build_args_scoped_to_nonsensitive_values`, `deployment_config_reviewed`, `existing_volume_map_verified`, `offline_restore_reused`, `db_forward_backward_compatibility_reviewed`, `staging_recovery_runbook_reviewed`. No passwords, secret hashes, plaintext registry URIs or client data in this index.

## C. Maintenance handoff — do not execute early

Only after Phase 2 owner releases shared staging, a downtime window is acknowledged, protected backups are current, image identity and rollback are validated, and all real artifact and schema checks pass, prepare *fresh distinct PostgreSQL and Redis credentials* in a protected credential manager. Reconcile API, backup and migration PostgreSQL connection URLs, Postgres DB role password, Redis `requirepass`, API Redis URL and healthchecks. Use a staged, restart-safe maintenance runbook with the same persistent volumes; never `compose down -v`, Docker prune or change the original Vault key. After coordinated rotation, prove both old passwords rejected and new passwords accepted via boolean-only protected tests; ensure all seven service containers, including migrate, reflect authorized scope. If any stage fails, STOP and use a previously validated recovery path. No automatic password substitution or service restarts are included in this branch.

## D. Exact status — do not overstate closure

| Requirement | Status |
|---|---|
| One real Vault ciphertext decrypted and verified | PASS, owner report |
| 12-field six-service nonempty runtime check | PASS, owner report |
| Archived Docker image restricted access on Windows and VPS | NOT ATTESTED |
| Registry/build-log audience restriction | NOT ATTESTED |
| Old image history Postgres/Redis leak | CONFIRMED, still exposed to holders |
| Clean immutable API/Web/backup signed source→OCI pair and full layer scans | NOT ATTESTED |
| Previous compatible rollback path #292 | NOT VERIFIED |
| Old password invalidation and new PostgreSQL/Redis credentials | NOT EXECUTED |
| Phase 2 staging handoff and maintenance window | NOT APPROVED |
| Phase 1 security #293 CLOSED | NO |
| Production changed | NO |
| Commercial GO | HOLD |
