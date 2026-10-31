# SchoolOS V5 — Isolated real-checkpoint recovery acceptance packet

**Prepared:** 31 October 2026. **Evidence state:** PREPARED — **NOT EXECUTED on real data**.  
**Decision:** `GO=HOLD`. The 10 formal commercial release gates remain `0/10 VERIFIED`.  
**Authoritative board:** GitHub #258; recovery #292; credential/image exposure #293.  
**Scope:** isolated V5 staging project `96ffcu0jinuwlnaqxpltln4p` only. V4 production is explicitly excluded.

## Already accepted — reuse without retesting

| Evidence | Established result | Scope limit |
| --- | --- | --- |
| Previous V5 offsite backup checkpoint | `20261031T073407Z` previously reported verified DB/files and R2 integrity | Not yet restored as a **coherent real application state** |
| 29 Oct offsite DB restore | Prior isolated DB restore PASS, 114 applied Prisma migrations, 336 tables, empty uploads | Not this current checkpoint or Vault/media restore |
| Corrected API image, owner-local | Source-pinned API `e41b8a9f5c8802e53be7fb96653410e117f9b243`; LF and shell syntax PASS | Signed provenance not attested |
| Owner-local synthetic API+PG rehearsal | `LOCAL_SYNTHETIC_APP_RECOVERY=PASS`, readiness and migrations PASS, cleanup PASS | **Only disposable synthetic data**, not restored offsite checkpoint |
| Draft #295 CI | `41221659731` completed SUCCESS including new API image and synthetic PG readiness | CI does not prove signature of any deployment image |
| Draft #296 | Backup script hardening: LF, restore URL, relocated checksum verification; additional synthetic image E2E CI under development | Do not count as passing until exact current PR head CI verifies |

**Untrusted/obsolete:** old four-image TAR `bf956547d243d02bca7ea9a152147a4d6920e74b2c7cc90ab44f0fe61d6ea5ca` contains the **broken API CRLF entrypoint**. It is importable but **must not** be used for V5 deployment or asserted rollback readiness.

## Strict execution boundary

- **Do not run an actual restore on the V5 staging host, existing Docker volumes, Coolify, production, or any attached production network.** Phase 2 continues to own the shared V5 staging lock.
- Real backup data includes student/guardian PII, institutional data and financial records. Keep any checkpoint bytes, archive manifests, decrypted Vault content, provider metadata and encryption keys exclusively on an owner-controlled **restricted isolated** recovery host. Do not upload to GitHub Actions, chat, public registries, AI tools or shared temporary folders.
- The isolated recovery host must have no route to staging/prod DB/Redis, no published host service ports, no real webhook/email/SMS or Razorpay LIVE mode; provider/e-mail/AI worker processes are disabled until explicitly scoped. Do not allow a restored app to contact third parties automatically.
- Use only an independently vetted, corrected source-pinned API/Web **pair** and a reviewed backup image. Prior API-only replacement does not alone prove an immutable Web+API pair; verify source/digests and compatibility before app boot.
- Operator must explicitly choose an RPO and RTO and name a restoration witness. Neither value may be fabricated.

## Evidence plan and stop conditions

| ID | Required action in restricted isolate | Sanitized evidence to retain | Decision |
| --- | --- | --- | --- |
| RC-01 | Record actual checkpoint ID, source storage object identity in a **restricted** register, creation UTC, checksum manifest original protected hash and read-only acquisition chain | `checkpoint_id`, `manifest_trust_source=PROTECTED_REFERENCE/UNKNOWN`, owner/date | PENDING |
| RC-02 | Verify exactly `database.dump`, `files.tar.gz` from the copied checkpoint with the corrected portable verifier; independently compare original protected manifest digest if available | `checksum_consistency`, `manifest_authenticity`, dump magic, file archive structural safety, no values | PENDING |
| RC-03 | Validate backup tar structure *before extraction*; reject absolute paths, traversal, symlink/hardlink/special-file entries, unexpected archive shapes and extraction outside a new empty scratch directory | `archive_path_safety`, safe-entry count, declared bytes; no names | PENDING |
| RC-04 | Restore DB **only into a disposable isolated PostgreSQL 16** using a fresh synthetic local user/password and no connection to live staging. Use an explicitly reviewed `pg_restore` command; never `--clean` against an existing environment | `pg_restore_exit`, `db_backend_isolated`, migration PASS/FAIL, table count, no row contents | PENDING |
| RC-05 | Restore `files.tar.gz` **only into a new empty isolated directory/volume**. Compare declared count and root path safety. Prior uploads may genuinely be empty; mark N/A with evidence, not invented PASS | `files_integrity`, file count, optional authorized nonempty fixture readback | PENDING |
| RC-06 | Establish encrypted Vault/key custody: presence and correct version/alias of original API-only key material in protected store. Under explicit authorization test decrypt of one actual non-sensitive/approved sample; keys or plaintext never appear in report | `vault_key_custody`, `vault_decryption=PASS/NOT_APPLICABLE/BLOCKED`, witness | PENDING |
| RC-07 | Verify external R2 LiveKit recording objects and any other object-store references with authorized read-only scoped access; test one authorized media playback/decode only if applicable, without emitting URLs/keys | `media_reference_count`, `media_head`, `playback`, scope exemption if none | PENDING |
| RC-08 | Verify Redis/session/cache implications: do not restore stale authentication sessions automatically. Review tenant, role, admissions, invoice/payment idempotency and scheduler state using aggregate **values-free** readbacks | `tenancy_safety`, `auth_safe`, `ledger_reconcile`, `worker_fencing` | PENDING |
| RC-09 | Bring up source-compatible API/Web only behind isolated, non-public network after all external workers/providers are disabled. Readiness, migrations, no external callbacks, representative tenant permission readback, and shutdown/cleanup | `api_health`, `web_health`, `no_external_side_effects`, `cleanup` | PENDING |
| RC-10 | Record measured RPO/RTO, original immutable reviewed artifact chain, operator/witness, exceptions, residual risk and dated human ACCEPT / CONDITIONS / REJECT | `operator_decision`, `witness_decision`, protected reference and time | PENDING |

**Never infer RC-06 or RC-07 PASS from a database-only restore.** If the checkpoint legitimately has no media/files/Vault documents, record exact applicable scope with attributable N/A disposition. If keys are missing or inconsistent, mark BLOCKED and **do not rotate/replace them to force decryption**.

### Read-only checkpoint preflight (prepared, **not run on real data**)

A guarded Python preflight is committed at `scripts/schoolos-v5-private-checkpoint-preflight.py`. It requires a **copy already located on the restricted isolated host** and examines only `SHA256SUMS`, `database.dump` and `files.tar.gz`. It does **not** import archives, start containers, execute SQL, decrypt documents, contact Cloudflare R2 or connect to any host. Its independent digest parameter must come from an **out-of-band trusted manifest record**, not simply a hash computed from the same untrusted copy.

Example on the **isolated private host only** (replace locally; never paste real paths into chat):

```sh
python3 scripts/schoolos-v5-private-checkpoint-preflight.py \
  --checkpoint-dir /PRIVATE_ISOLATED_COPY/checkpoint \
  --checkpoint-id 20261031T073407Z \
  --report /PRIVATE_PROTECTED_REPORT_DIR/preflight-unique.json
```

If an authenticated original SHA-256 of the `SHA256SUMS` manifest is available from the owner-controlled protected register, include `--trusted-manifest-sha256 <64-hex>` to verify it independently. Otherwise `MANIFEST_AUTHENTICITY=NOT_ATTESTED` is the correct result despite internal checksum PASS. The report is created exclusively with `0600` on Unix and cannot overwrite an existing file.

**The preflight is a read-only structural and consistency gate**, not a real DB restore, media/Vault recovery, authentic source chain or cryptographic signature. It rejects tar traversal, links and special entries; legitimate archives containing links will require documented manual review rather than automatically extracting. No copied real checkpoint should be committed, uploaded or attached to GitHub issues.

### Owner-local restore runner prepared — only after private checkpoint acquisition

The new `scripts/schoolos-v5-owner-isolated-checkpoint-restore.py` implements RC-02, RC-04 and RC-05 **only when run on an owner-controlled Windows Docker Desktop Linux engine**. No data transfer is performed by the tool. Do not run from the V5 staging VPS or any SSH/remote Docker context.

**Safety characteristics:** explicitly validates the local `desktop-linux` Windows named-pipe endpoint, requires a cached `postgres:16-alpine` image (no pull), validates the checksum and tar entry safety before starting, uses only `--network none`, a **read-only bind mount of a privately copied checkpoint**, and separate discarded-on-stop tmpfs PostgreSQL data and file-extraction directories. No Compose, existing Docker volumes, host ports, backups/R2 access, Coolify, real provider keys or production services. PostgreSQL `pg_restore` is performed in a freshly initialized ephemeral DB, with only aggregate table/migration counts reported; `files.tar.gz` is extracted only inside ephemeral tmpfs. Output and 0600 report contain status/aggregate evidence, not customer records. A failure to verify container ownership or remove the ephemeral container is a hard HOLD, not a success.

The *default* invocation is read-only preflight; actual isolated restore requires **both** `--execute-isolated-restore` and `--acknowledge-private-offline-checkpoint`. Use a **private, encrypted, non-cloud-synced** copy, with exactly `SHA256SUMS`, `database.dump`, `files.tar.gz`. Do not paste source paths, manifest contents, R2 object keys, dumps, student records, Vault keys or raw Docker logs into chat or GitHub. The report path must be outside the checkpoint folder and must not exist already.

Illustrative commands on the **owner's private Windows machine**, from a pinned checked-out PR #297 branch (replace placeholders with privately selected absolute paths, not in chat):

```powershell
$checkpoint = 'C:\PRIVATE_ISOLATED_COPY\20261031T073407Z'
$preflight = 'C:\PRIVATE_PROTECTED_REPORTS\preflight-unique.json'
py -3 -B scripts/schoolos-v5-owner-isolated-checkpoint-restore.py `
  --checkpoint-dir $checkpoint `
  --checkpoint-id 20261031T073407Z `
  --report $preflight

# Only after the preflight passes and the operator explicitly confirms
# source-origin controls, data protection, machine isolation, and capacity:
$restoreReport = 'C:\PRIVATE_PROTECTED_REPORTS\restore-unique.json'
py -3 -B scripts/schoolos-v5-owner-isolated-checkpoint-restore.py `
  --checkpoint-dir $checkpoint `
  --checkpoint-id 20261031T073407Z `
  --report $restoreReport `
  --execute-isolated-restore `
  --acknowledge-private-offline-checkpoint
```

Do **not** run the illustrative commands until the protected checkpoint has actually been acquired and isolated and the branch's exact-head CI is successful. If the original manifest's digest is available from an independent trusted protected record, add `--trusted-manifest-sha256 <verified 64 hex>`; otherwise the report explicitly retains `NOT_ATTESTED` for origin. Only statuses/counts are permitted into Issue #292.

**Limit of achievement even after this passes:** it proves only that this **real DB dump and archived files** can be restored into a disposable isolated environment. Application-backed Vault decryption, external R2 media, coherent API/Web state, payment-ledger reconciliation, source→image attestation, witness and RPO/RTO decisions remain independent blocked gates.

### Restricted operator workflow (no staging changes)

1. Keep existing #258 lock. Verify the isolated recovery engine/host has no shared V5 production/staging volumes, remote Docker context, routed provider access or published ports. Record host/isolation attestation privately.
2. Obtain the exact `20261031T073407Z` checkpoint **through an approved read-only path** into an access-restricted directory. Confirm independent out-of-band origin/trust evidence; the archive's own checksums prove only internal consistency.
3. Run preflight checks on the **copied files only**: two checksum records, custom PostgreSQL dump marker/header, structurally safe tar names. Do not extract until checksum and traversal guards pass; retain only sanitized booleans and counts.
4. Pin the reviewed corrected backup image, its digest and source. Run the source-verified backup/restore utility only inside an isolated scratch environment; do not run `restore.sh` directly on an existing DB because it uses `pg_restore --clean`.
5. Restore to a freshly created PostgreSQL 16 sandbox and empty files volume; record exact start/finish UTC, pg_restore status, SQL migration state, aggregate DB counts, uploads and consistency. All access credentials are sandbox-only and disposed with this environment.
6. Evaluate Vault/media/auth/ledger/worker fencing separately with human-scoped keys and provider read-only access. Keep all outbound providers blocked until verified and explicitly authorized.
7. Store evidence and human signoffs in protected storage; post **only** status codes and protected evidence references to Issues #258/#292. Report no student names, DB URLs, provider object keys, secret hashes or source logs.
8. No staging promotion or credentials rotation until #293 security acceptance, #292 provenance+recovery, Phase 2 lock transfer and a separately approved change window.

## Evidence record template — populate only from observed results

```json
{
  "project": "SCHOOLOS_V5_PHASE1_RECOVERY",
  "checkpoint_id": "20261031T073407Z",
  "scope": "isolated_disposable_recovery_only",
  "checkpoint_origin_authentication": "PENDING",
  "backup_image_reviewed_digest": null,
  "api_image_reviewed_digest": null,
  "web_image_reviewed_digest": null,
  "source_build_provenance": "NOT_ATTESTED",
  "manifest_integrity": "PENDING",
  "database_restore": "NOT_EXECUTED",
  "files_restore": "NOT_EXECUTED",
  "vault_key_custody": "PENDING",
  "vault_decryption": "NOT_EXECUTED",
  "external_media_validation": "NOT_EXECUTED",
  "tenant_and_ledger_consistency": "NOT_EXECUTED",
  "outbound_provider_side_effects": "NOT_EVALUATED",
  "isolated_application_readiness": "NOT_EXECUTED",
  "rpo_minutes": null,
  "rto_minutes": null,
  "cleanup": "NOT_EXECUTED",
  "operator_approval": "PENDING",
  "reviewer_approval": "PENDING",
  "protected_evidence_locator": null,
  "staging_changed": false,
  "production_changed": false,
  "commercial_go": "HOLD"
}
```

**No approvals are inferred from preparation.** No automatic previous-version rollback, DB downgrade, real credential rotation or staging deployment is authorized by this packet.
