# SchoolOS V5 — Phase 1: protected rollback custody and historical DB/Redis rotation handoff

**Date:** 3 November 2026. **Scope:** V5 staging project `96ffcu0jinuwlnaqxpltln4p` only.
**Decisions:** `PHASE1_ACCEPTANCE=HOLD`, `CREDENTIAL_ROTATION=NOT_EXECUTED`,
`COMMERCIAL_GO=HOLD`. No shared staging or V4 production modifications under this branch.

## Proven evidence to reuse (do not retest without changed inputs)

- Owner successfully restored real private checkpoint `20261031T073407Z` into owner-local
  disposable, offline PostgreSQL and ephemeral files storage. DB, files, integrity and cleanup
  all PASS; no private checkpoint uploaded or staging/production changed.
- V5 local Docker backup volume had 16 complete checkpoints; checkpoint above present.
  Cloudflare R2 counterpart manifest matched local checksum manifest, but there is **no
  independently trusted manifest signature**.
- PR #310 source-locked prior V5 API/Web rebuilt, bounded image layer and metadata
  safety checks passed, and current-source → older-derived API → current-source synthetic
  PostgreSQL boot passed at exact SHA `028be601e1f41420544f5f4425a3f1fa97d9dc53`.
  That test does **not** establish real customer/Vault/media rollback compatibility.
- Old deployed image archive has confirmed historical PostgreSQL/Redis secret exposure in
  build history (#293). Restrict/archive the evidence, do not publish, reuse or expose the image.
- No trusted/immutable/retrievable previous API+Web OCI pair, owner-controlled
  restricted registry/signed image manifest, or full application recovery has been evidenced.

## Source-pinned signed CI receipt (proposed in this PR)

New CI prepares an **exact-source, values-free build receipt**, recording only Git SHAs,
Docker local image config digests and rootfs diff IDs for the separately rebuilt prior API/Web.
GitHub OIDC attests the receipt after the bounded image audit and the synthetic compatibility test.

This strengthens independently verifiable build *receipt* provenance, not image custody.
`actions/attest@v4` only signs the small JSON report. **The actual OCI images are never
signed, retained, pushed to any registry, placed in GitHub Artifacts or made retrievable.**
Self-reported local Docker source labels are not sufficient identity attestations. The derived
API recipe omits only two hash-pinned upstream dotenv README examples; it is not an
independently certified byte-identical build of the previously deployed API.

## What must happen to establish genuine artifact custody (#292)

1. **Approved private destination**: owner chooses a *separate restricted* artifact bucket or
   private registry independent of the public GitHub repository. Verify access audience and
   retain an exact authorized list; do not repurpose the live staging backup credentials for
   image publication. No raw image, secret values, Docker config/history, manifest contents or
   customer backup bytes may go into GitHub issues, ChatGPT, or public Actions artifacts.
2. **Immutability**: if using Cloudflare R2, apply a **narrow bucket-lock rule** solely to the
   dedicated artifact prefix/bucket and a separately approved retention period. Cloudflare
   bucket-lock updates replace the entire rule set; retrieve/review existing rules before any
   administrative change. Do not modify the live backup bucket's lock configuration as a
   shortcut. Bucket locks prevent overwrite/delete during retention but alone cannot certify
   source origin or prevent authorized retrieval.
3. **Binary provenance**: build candidate API/Web/backup and older API/Web from explicitly
   reviewed immutable source/recipe. Gate exact SHA, clean-build source, no injected sensitive
   build args, metadata and full-layer inspections; independently verify builder identity and
   *actual OCI manifest digest* signatures. Do not treat image config ID or source label
   as an OCI registry manifest digest.
4. **Retention + retrieval**: verify each immutable OCI object exists by digest; prove
   readback from an independently authenticated retrieval context, recompute manifest digest,
   verify signatures/provenance, and boot the retrieved prior API/Web images in a
   network-isolated sandbox. Use a *restricted*, separately copied checkpoint to verify
   application plus DB/files/Vault/media compatibility, not only a synthetic DB.
5. **Evidence gate**: record sanitized receipt references in
   `scripts/schoolos-v5-phase1-rollback-evidence-gate.py` (V2), independently validate
   the underlying protected signatures and artifact retrieval. The Python gate validates
   declarations, not cryptographic signatures; even PASS does NOT authorize deployment.

## Historical PostgreSQL/Redis rotation — preconditions and operations (#293)

**Do not rotate now:** the earlier pair is not yet retrievable/verified, shared Phase 2 staging
has not been released for maintenance, and source-backed runtime secrets/audience are still
not attested. Rotation is an authenticated operations change, not a Git commit.

Before maintenance:
- Record approved downtime window, named operator/witness, rollback destination, backup
  checkpoint, current seven-container and persistent-volume identity, and Phase 2 release
  from the shared staging lock. Verify separate continuity of the Vault/payment encryption
  keys; **do not rotate those encryption keys** as part of PostgreSQL/Redis remediation.
- Preserve restricted forensic old archives. Record which principals can access old images
  and logs. Purge/access-restrict only under incident retention decisions, not blindly.
- Inventory all staging secret consumers without printing values: PostgreSQL database role;
  API, migrate and backup DB URLs; Redis service, API Redis URL, healthchecks, worker
  connections and Coolify stack-wide environment injection.
- Prepare **distinct new high-entropy PostgreSQL and Redis credentials** in protected
  owner-only custody. Never put them in shell history, GitHub Actions, Git, logs, chat,
  `docker build --build-arg`, image labels, Dockerfiles or unrestricted Compose files.
- Confirm source and deployment design no longer injects plaintext into image history.
  Note existing Redis Compose command contains an interpolated `--requirepass`; review
  argv/Compose process-list exposure and move credentials to an approved runtime-only
  secure configuration mechanism before rotating. Changing environment entries alone
  does not sanitize previously exported image layers.

In approved maintenance only (atomic coordination required):
1. Stop or fence affected API/worker operations and ensure all read/write consumers share
   the maintenance window. Keep persistent Docker volumes unchanged.
2. Update PostgreSQL role password through an authenticated protected channel while
   updating **all** database connection clients/configs together. Merely setting
   `POSTGRES_PASSWORD` on an existing `postgres:16-alpine` persistent volume **does not**
   rotate the PostgreSQL role password.
3. Update Redis authentication configuration and all clients together; preserve existing
   Redis data and plan for credential invalidation/reconnection. Do not pass new secrets as
   process arguments or echo them in shell history/logs.
4. Restart only the approved affected V5 services in a dependency-aware order, including
   any one-shot migrate dependency. Validate correct project/image pair and unchanged
   named volumes; never use `compose down -v` or `docker system prune`.
5. Probe authorized API/worker DB and Redis connectivity and service health; test
   **old PostgreSQL and Redis credentials rejected** and **new credentials accepted**
   through a protected boolean-only verifier. Do not leak either value or a password hash.
6. Recheck six non-API runtime credential scopes, API/Web health, backup and protected
   key custody; record operator and witness decisions with sanitized evidence.
   Unexpected failures STOP and invoke only the already-proven recovery plan.

**Stop conditions:** no immutable prior image pair, untrusted retrieval, backup integrity drift,
real data compatibility gap, Phase 2 staging lock in force, wrong Compose/volume IDs,
uncertified secret scopes, missing protected key recovery, or any unexpected real-service
health regression. In any of these cases, mark `ROTATION=HOLD`; never claim 100%.

## Phase dependencies / status

- Phase 1 may continue clean source/CI and private custody planning independently.
- Phase 2 BBA branch admin UAT remains separate; release staging lock before Phase 1 rotation.
- Phase 3 provider TEST-to-ledger/finance evidence is not implied by any Phase 1 result.
- Formal release remains 0/10 signed/verified gates until actual evidence is entered
  through Issue #258 and the machine-enforced release manifest. Do not auto-promote.
