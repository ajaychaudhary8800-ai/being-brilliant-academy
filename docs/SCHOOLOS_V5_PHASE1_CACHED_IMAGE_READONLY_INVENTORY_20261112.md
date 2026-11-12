# SchoolOS V5 Phase 1 — Cached API/Web Image Candidate Inventory (owner-readonly)

**Status:** source-only, pending owner-run evidence. **Project:** SchoolOS V5 staging Compose project `96ffcu0jinuwlnaqxpltln4p`, **not** Adhyay psychometric. Tracks #292, #293 and formal release board #258.

Previous owner inspection reported `CACHED_PREVIOUS_IMAGE_PAIRS=0` among images with both valid reviewed source labels and matching service workdirs, with unlabelled possible images not exhaustively attributed. An older Web archive's Docker **build history had sensitive plaintext DB/Redis values**: **never** attach raw `docker inspect`, Docker history, exported TAR/config, private registry links, or environment to issues/chat. A local image can be structurally cached yet **unsafe to reuse**. This inventory is a discovery tool only, never a clean/image rollback endorsement.

## Read-only audit

`scripts/schoolos-v5-readonly-cached-image-inventory.py` uses Docker CLI `container ls`, `container inspect`, `image ls`, and `image inspect`, with **static narrow Go templates** requesting only:

- current scoped staging container image IDs, service labels and running status for API/Web;
- cached image IDs, one source-revision label and the WORKDIR used for API/Web *candidate* classification.

The script never calls `docker history`, `docker save`, `docker load`, `docker pull`, `docker build`, `docker exec`, `docker run`, image prune, `docker compose`, container restart, database or backup access. It does not print image IDs, environment, image config, history, tags, repository names, registry URLs, volumes, secrets, mount paths, object data or customer information. It inspects image metadata on the Docker host and emits only sanitized aggregate counts plus strictly validated 40-character Git revision IDs when a *potential* API/Web pair exists. Docker CLI error text is suppressed.

Current service role identification uses service/workdir pairs exactly `api`/`/workspace/apps/api` and `web`/`/app`. An older image must have the **same** noncurrent 40-hex revision label in both API and Web workdir classes to be counted as a candidate pair; source revision may be unrelated or later until independently checked against Git history. Any unexpected missing/invalid current label, workdir mismatch or wrong container count returns `HOLD_UNVERIFIED`. A valid-looking Docker label is **self-declared**, never evidence of clean provenance.

### Run remotely without uploading scripts to VPS

Review exact GitHub commit and source before executing. On the owner's **Windows PowerShell**, in `D:\Development\being-brilliant-academy`, fetch the reviewed dedicated draft branch:

```powershell
git fetch --no-tags origin security/schoolos-v5-phase1-cached-image-inventory-20261112
if ($LASTEXITCODE -ne 0) { throw 'SOURCE_FETCH_FAILED' }

git show 'FETCH_HEAD:scripts/schoolos-v5-readonly-cached-image-inventory.py' |
    ssh -T root@<YOUR_STAGING_VPS_IP> 'python3 -'
```

**Before running**, replace the placeholder with your *already trusted* V5 staging VPS host address. Do not blindly paste unreviewed scripts or use a V4 production connection. The script is read-only but requires Docker CLI inspection access, so keep SSH credentials protected.

For offline-only synthetic tests without Docker:

```bash
python3 -m unittest -v scripts/test_schoolos_v5_readonly_cached_image_inventory.py
```

The printed output will include `V5_POSSIBLE_DISTINCT_REVISION_PAIRS`, optional strictly validated `V5_POSSIBLE_SOURCE_REVISIONS`, and counts of `V5_UNLABELLED_*_IMAGE_CANDIDATES`. If `NOT_EVIDENCED`, an independently reproducible signed clean **previous** build and true immutable OCI readback are still necessary. If a potential pair appears, the owner must separately verify Git ancestry, exact immutable source/build recipe, no secrets in *all* layers/history/config (in a restricted audited context), signed attestations, physical artifact custody and genuine checkpoint app/DB/files/Vault/media recovery.

### Hard-stop status

Do not upload or reuse historically exposed older Web/API images solely because they appear in the inventory; their secret-bearing metadata remains an incident. This tool never marks a past image `CLEAN`, `SIGNED`, `RETRIEVABLE`, `IMMUTABLE`, `VERIFIED_PREVIOUS` or `ROLLBACK_READY`. It may examine metadata for non-SchoolOS local images as part of counting/filtering but prints no such metadata. All mutation, source-image signing, trusted R2 publisher/reader, real restore and historical credentials are separately controlled. `DEPLOYMENT_AUTHORIZATION=HOLD` always.

Refs: #258, #281, #292, #293 and source-only #331. Dedicated R2 bucket's owner-reported 90-day private prefix lock control-plane preflight now passed **configuration only**; R2 object custody/clean artifact production remains open.

## 12 Nov 2026 — first owner-run reported safe HOLD; classified diagnostic revision

The first owner-run against the original V5 staging Docker host from the exact reviewed initial script returned:

```text
V5_DOCKER_IMAGE_INVENTORY=HOLD_UNVERIFIED
IMAGE_CONFIG_ENV_OR_HISTORY_READ=NO
DOCKER_IMAGE_OR_SERVICE_MUTATION=NO
DEPLOYMENT_AUTHORIZATION=HOLD
```

This is **not** evidence that previous images are absent. The deliberately coarse first version masked one of several possible read-only inspection assumptions (running service labels, unexpected container/image IDs, source label, workdir, or Docker Go-template compatibility). No image was used, exported, pulled, built or mutated.

The subsequent patch emits **one fixed safe diagnostic status code** `V5_INVENTORY_BLOCKER` without Docker stderr, environment, image IDs, registry paths, container names, arbitrary labels or user-provided values. The codes distinguish:

- `SCOPED_CONTAINER_LIST_UNAVAILABLE`, `SCOPED_CONTAINERS_NOT_FOUND`, `CONTAINER_ID_INVALID`, `CONTAINER_METADATA_INSPECT_UNAVAILABLE`, `CONTAINER_METADATA_FORMAT_INVALID`, `CONTAINER_IMAGE_ID_OR_STATE_INVALID`, `DUPLICATE_RUNNING_API_OR_WEB`, `RUNNING_API_WEB_NOT_FOUND`.
- `IMAGE_LIST_UNAVAILABLE`, `IMAGE_LIST_ID_INVALID`, `IMAGE_METADATA_INSPECT_UNAVAILABLE`, `IMAGE_METADATA_FORMAT_INVALID`, `ACTIVE_IMAGE_NOT_IN_LOCAL_IMAGE_LIST`.
- `ACTIVE_IMAGE_WORKDIR_MISMATCH`, `ACTIVE_IMAGE_REVISION_LABEL_MISSING`, `ACTIVE_API_WEB_REVISION_MISMATCH`.

These outcomes are **sanitized HOLD diagnoses only**. Do not circumvent a missing running-service identity, revision label or image provenance to mark any release gate PASS. Review each mismatch against the exact deployed V5 source metadata and retain fail-closed behavior. The added 6 tests specifically validate safe categorical errors and suppress simulated sensitive Docker exception messages. Only run the inspected immutable SHA of the updated PR after its exact-head CI passes. No power to authorize deployment is added.

## 12 Nov 2026 — owner Docker narrow-template diagnostic confirms combined-template incompatibility

Owner's sanitized, read-only Docker probe on the V5 staging VPS returned:

```text
IMAGE_LIST=PASS
IMAGE_COUNT=40
FIRST_FAILED_IMAGE_INDEX=11
ID_INSPECT=PASS
WORKDIR_INSPECT=PASS
REVISION_INSPECT=PASS
SENSITIVE_VALUES_PRINTED=NO
DOCKER_MODIFICATIONS=NO
DEPLOYMENT_AUTHORIZATION=HOLD
```

**Supported conclusion:** `docker image ls` succeeded (40 list entries); a **combined Go-format metadata inspection** failed for image position 11, but *all three individual narrow templates* succeeded for that image. Do not interpret this as a corrupt image, a missing rollback pair, credentials problem, current runtime failure, or Docker host corruption. All output was sanitized; neither credentials nor real image identities are needed to solve the formatting problem.

The revised source queries image ID, workdir and the sole approved source-revision label through **three independent docker image inspect --format commands per image**, with output size/type bounds, strict id matching and disallowed raw delimiters/newlines. It preserves the existing Compose project guard, source-label validation, untrusted candidate classification and `DEPLOYMENT_AUTHORIZATION=HOLD`. Synthetic test now exercises 40 images/120 independent metadata lookups, including the failure at the 11th combined format, with no composite-image template call. Re-run ONLY after exact SHA and CI success are confirmed; once source metadata inventory succeeds, independently review whether an older API+Web pair is actually evidenced. Previously exposed images remain **forensic/restricted, not approved rollback artifacts**.

**Project boundary:** The operator's terminal prompt showed `D:\Development\Adhyay-Priority6-Integration` during the diagnostic, but the read-only Python probe was streamed over SSH to the intended V5 Docker host. For all future V5 `git fetch` / `git show` invocations, explicitly set `D:\Development\being-brilliant-academy` first. Do not mix commits, migrations, image acceptance or database actions from Adhyay Platform psychometrics into SchoolOS V5.
