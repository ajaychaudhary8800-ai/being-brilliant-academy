# V5 Phase 1 — Owner read-only cache rollback candidate discovery

**Scope:** Independent rollback-preparation only. No local/staging production mutation. Supersedes no historical test and does not certify signed rollback. Commercial GO HOLD.

## Reason for this additional independent check

An earlier image scan examined 46 cached images and found **zero eligible previous API/Web pairs** using exact older 40-character revision labels and expected service working directories. That scan does not establish that every unlabelled legacy image is unusable. The current source-pinned V5 staging candidate is distinct from the old deployed source; a health-check from a CI ephemeral build is not a retrievable backwards compatible rollback artifact.

## New deterministic read-only inventory

`scripts/schoolos-v5-rollback-cache-candidates.py` allows the owner to query only Docker metadata on the known V5 staging VPS. It requires a deliberate `--read-only-v5-rollback-cache` flag and root on Linux. It inspects exactly the seven containers in Compose project `96ffcu0jinuwlnaqxpltln4p`, including the stopped migration, records the current API/Web image IDs privately in memory, inventories all locally cached image metadata without pulling images or consulting registries, then identifies role-compatible API/Web images by work directory and entrypoint/CMD signature, further classifying valid revision labels and unlabelled candidates.

It prints only **aggregate counts**: number of images scanned, number of possible labelled older role revisions, number of unlabelled role candidates, and number of overlapping API/Web older revision labels. It prints no image IDs, image names, registry addresses, revision SHAs, raw Docker config, history, `Config.Env`, secret values, URLs, customer data, file paths or Docker tags. Unknown or malformed metadata returns `CHECK_REQUIRED`. It does NOT run old containers, change staging state, import archives, pull from registries, access raw layers, or attempt a database migration.

**Crucial interpretation:** a positive matching revision count is only a **candidate for restricted manual provenance and compatibility review**. An older cached image could still contain the previously exposed secrets, be tampered with, fail application startup, lack an accessible manifest or be incompatible with the recovered PostgreSQL schema. A zero count would confirm no candidate with the tested matching signature; old archives or independently reproducible signed rebuilt artifacts remain alternative recovery approaches. There is no automatic launch authorization.

## Required evidence to actually close #292

1. Identify one approved prior source revision with exact `api` and `web` image digest and a corresponding compatible or restore-based data recovery plan. Registry/storage retrieval must be tested without overwriting active service images or tags.
2. Verify source/OCI provenance with a trusted attestation, metadata + full filesystem-layer secret scan, and original-image access custody. Merely having an image ID or revision label is insufficient.
3. In an isolated recovery environment, start actual application components with protected or synthetic credentials and a disposable restored dataset, verify version-compatible database access, authentication and migration behavior, then evaluate RTO/RPO.
4. Preserve current V5 named Docker volumes and backup access; never attempt `docker compose down -v`, tag replacement, ad-hoc in-place schema downgrade, image pruning or secret rotation while Phase 2 UAT owns shared staging.

## Owner command after exact-head CI

Run only the reviewed SHA of this PR by piping the Python source to SSH on the known VPS. For example, after checking out the exact commit and verifying the SHA on Windows PowerShell:

```powershell
$script = Join-Path $source 'scripts\schoolos-v5-rollback-cache-candidates.py'
Get-Content $script -Raw -Encoding UTF8 | ssh -T root@200.141.12.225 'python3 - --read-only-v5-rollback-cache'
```

Do not run this from the shared Docker host with the script's contents pasted into a support ticket. Only share sanitised count and status lines.
