# SchoolOS V5 — Phase 1 security and deployment evidence ledger (30 Oct 2026)

**Classification:** V5 isolated-staging security engineering review; **NOT** a signed release decision or independent penetration-test certificate. **Production commercial status: HOLD; all 10 release gates PENDING.** Do not merge this Phase 1 branch into V4 `main` or deploy it to the shared staging environment while Phase 2 is working.

## 1. Exact scoped revisions and attribution

- Cumulative V5 development / most recently reported staging API and Web source revision: `b54dca5ae36a948f83012faa4a37354198fba083`, integrated via #289 on 30 Oct. Its four exact-head workflows (CI `41016097520`, isolated sandbox `41016097522`, external read-only QA `41016097518`, V4 upgrade `41016097523`) reported **SUCCESS**; automated CI is not independent build attestation.
- Manifest candidate `dd1315f6a0b572019bcb9bf565cf79452c95dd37` is **older** than that staging source by two commits. Candidate-to-staging comparison lists five files: branch provisioning API/UI and their tests, and release manifest. **Neither image label nor CI converts the stale candidate pin into owner-approved release source.**
- Last operator-reported staging API local image ID: `sha256:2093e7312d1e76698643623a349d76117e8e4cb774c2c8e4ad1c0412f57a564a`; Web local image ID: `sha256:b9d924fe0d473ce89c54348f09371d6b14976027bce7c1433cfb2e5149dcf77e`. Both are operator-supplied from 30 Oct; API/Web labels report `b54dca5...`, health **healthy**, and public staging readiness/operational HTTP **200**. These are **local image IDs**, **not** verified immutable registry image manifest digests and **not** an independently reproduced source-to-image proof. Preserve actual image refs and protected build logs before making a rollback claim.
- The Phase 1 security-control-only feature branch starts exactly from `b54dca5...` and does not include any concurrent Phase 2 changes subsequently made to the cumulative branch. The draft fix here changes only the **read-only audit script and its native tests**; it is **not deployed**.

## 2. Issue #281 — reuse of existing technical remediation evidence

| Control | Most recent specific evidence | Scope and limitation |
| --- | --- | --- |
| Six non-API services, including stopped migrate | #281 comments 6497444327 / 6497482807: core and media API secrets reported **0** for `backup, migrate, nginx, postgres, redis, web` after isolated V5 staging cutover at `f736e64b...`; Coolify persisted generated `.env` core-secret nonempty count **0** | Direct values were not printed; historical operator-observed snapshot, not a freshly independently executed test of `b54dca5...`. |
| API protected JWT/SMTP/Vault, Razorpay and media files | #281 comments 6497444327 / 6497797717: root-owned protected API-only read-only mounts and prior protected runtime settings PASS; source `docker-compose.schoolos-v5-staging.yml` restricts one-shot migrate to `NODE_ENV` and `DATABASE_URL` | Do not infer broader host compromise absence or secure backup/registry access simply from mounts. |
| SMTP and authentication | #281 comments 6497535028 / 6497585664: QA coaching-admin interactive login and refresh PASS; SMTP `transport.verify()` PASS | Not token revocation, multi-role UAT or full email delivery proof. |
| Vault crypto | #281 comment 6497797717: actual compiled Vault synthetic AES-256-GCM encrypt/decrypt/tamper PASS after file-scoped environment cutover | Does not prove existing encrypted-document retrieval, administrator authorization or offsite key recovery. Do not rotate Vault/JWT keys blindly. |
| Migration and persistent volumes | #258 comment 6517104596: V5 predeploy PASS; all four named volumes preserved, six services healthy and secrets files 0600; #258 comment 6517316837 records updated API/Web running revision and health | Operator report, not an independent registry digest or active rollback availability check. |
| Isolated offsite DB recovery | #258 body and approval packet: 29 Oct `RESTORE_TEST=PASS`, 114 applied, 0 unresolved migrations, 336 tables, amcheck PASS, 0 invalid indexes, empty uploads | No nonempty uploads, Vault document or LiveKit recording recovery established. No repeat restore for paperwork. |

**Technical conclusion:** The previously observed non-API credential inheritance is **remediated in operator-reported runtime evidence**; Issue #281 remains **OPEN** for accountable historical exposure/risk acceptance and targeted new-configuration evidence. This ledger does not assert credentials were stolen. Repeat key rotation is **not** a standard acceptance action. Reuse earlier passing tests unless a material code/config/security change invalidates their scope.

## 3. New Phase 1 source-level hardening on isolated branch

Existing `scripts/schoolos-v5-staging-provenance.mjs` already reads all project containers via `docker ps -aq` and `docker inspect`, prohibits non-API protected media/core secrets and checks mount scope, volumes, API/Web labels, TEST payments and disabled paid-video. Four remaining **false-PASS conditions** were identified in the source:

1. It inspected a stopped `migrate` container **if present**, but could return technical PASS when that container was **missing, duplicated, running or exited nonzero**. Phase 1 now requires **exactly one stopped migration container with exit code 0** and emits only count/success markers. This verifies it was included in the seven-container audit boundary.
2. The `entryEnvironment()` Map previously kept only the **last occurrence** of an environment key. A nonempty secret followed by an empty duplicate could be hidden from the security-key scan. Phase 1 now checks **every Env entry** for nonempty protected core/media values, still emitting no secret values.
3. A project-labeled **unreviewed sidecar** or service with a missing Compose service label could pass without explicit inventory validation. Phase 1 now rejects every unexpected service label in the isolated V5 project; no new service is implicitly trusted.
4. The previous runtime audit validated `api.DATABASE_URL` against the isolated V5 database but did **not** validate the `migrate` or `backup` service target. An unrelated Coolify override could allow migrations or backup reads against the wrong database despite API checks passing. Phase 1 now checks exactly one URL per service, confirms the approved internal PostgreSQL host/database for all three, and rejects URL mismatches with the API, using reason codes only. **This is a source-level audit coverage gap, not evidence that the deployed staging backup or migrate currently uses an incorrect database.**

Native regression tests cover missing/duplicate/running/failed/unknown-exit migration, unreviewed sidecar/absent service label, migration/backup wrong database and URL parity, and all **six** non-API services with shadowed nonempty secrets. The new implementation does not read or modify secrets, Docker state, database, files, uploads, config, deployment or provider services. **Await exact-branch CI; do not claim a test pass before GitHub returns success.**

**Boundary:** This audit only verifies the Docker metadata snapshot. It does **not** prove that actual running API environment contains necessary keys, that OCI labels are authentic build attestations, that backup contents are restorable, or that no host-level credential access occurred. Stopped container disappearance should fail closed; an operator can document intentional cleanup and refer to independent archived migration proof instead of silently counting it.

## 4. Deployment / rollback review: recorded vs missing

- **Staging only:** Coolify isolated Compose project `96ffcu0jinuwlnaqxpltln4p`; private backend network and backup egress; four existing external named volumes for PostgreSQL, Redis, application uploads and backups. No V5 Phase 1 rollout is requested. Production `beingbrilliantedu.com` / V4 `main` remain outside scope.
- **Source delta:** GitHub compare `f736e64b...` → `b54dca5...`: 6 commits / 20 listed changed files, including branch-provisioning API/UI, tests, governance/docs and CI. No Compose, Dockerfile, Prisma schema or migration file changed in that comparison. This is meaningful *schema-delta* evidence but is **not by itself a proven application rollback to old images**; new BBA manager-deferred branch data and current API behavior still require rollback compatibility review.
- **Immutable provenance still required:** artifact for exact source checkout, trusted build runner/workflow run, source `git rev-parse`, Docker build inputs, image `Id`, registry `RepoDigests`/signed manifest digest where published, deployed container `Image`, and a human-accepted mapping for *both* API and Web. Current image IDs are known from operator's report; repository/registry immutable digests and build-chain linkage remain unknown.
- **Rollback image availability still required:** read-only `docker image inspect` for approved **previous** API and Web image references plus their exact IDs, registry references/digests if any, and retainability through the planned change window. Do not assume an older tag is available or silently pull an unreviewed image.
- **Config compatibility still required:** exact V5 Compose checksum/identity, all four mount sources and destination paths, protected file paths (not content), current 114 migration state, and compatibility of prior rollback images with any data written by the new BBA deferred-manager workflow. No database downgrade without independent written compatibility decision.
- **Recovery action boundary:** obtain and verify a protected checkpoint of database, uploads, Vault key custody and offsite media/recording scope before any *later authorized* rollout; preserve backup version/manifest identity, no destructive `docker compose down -v`, no image prune/volume removal, and no blind older API start against incompatible database state.
- **Abort criteria:** credential reappearance in *any* of six non-API containers, failed migration, image ID/digest mismatch, tenant boundary failure, loss of protected file read access, 5xx readiness, failed login, data integrity or provider callback drift. Freeze writes where needed, retain evidence, and activate approved incident/rollback authority; an image-only rollback is permitted **only** after schema/state compatibility is demonstrated. Otherwise rehearse isolated restore and recover coordinated DB+uploads+keys under separately authorized incident command.
- **Coordination:** Phase 2 uses the same V5 staging service. No Phase 1 staging deploy, image replacement, source/pin modification in cumulative V5 or production merge unless Phase 2 explicitly releases the staging lock through #258 and the exact target/digests/deploy have owner approval.

## 5. New read-only local-image and rollback availability collector

New source: `scripts/schoolos-v5-image-rollback-inventory.mjs`. This is an **inventory collector, not a redeployer or independent build attestation**. It runs only Docker `ps -aq`, `inspect` and `image inspect` against a strictly named isolated V5 Compose project; there are no shell invocations, restarts, pulls, builds, DB requests, mounts, container removals, credential content output or staging traffic. It calls the strengthened full seven-container security audit first. Its native isolated fixtures verify correct current API/Web image availability/workdir/revision metadata, incorrect/missing/duplicate current images, optional previous pair identity, false rollback claims, malformed target/source and redaction of image Env, image tags, repository names and other metadata.

**Authorized operator run, whenever a consistent staging snapshot can be captured without interrupting Phase 2:**

```sh
node scripts/schoolos-v5-image-rollback-inventory.mjs \
  --project=96ffcu0jinuwlnaqxpltln4p \
  --source=b54dca5ae36a948f83012faa4a37354198fba083
```

The default (no selected previous-image pair) **intentionally reports `CHECK_REQUIRED` and exits nonzero**, because it cannot invent a safe rollback pair. Running this script from a checked-out Phase 1 review copy is read-only; it does **not** require changing the deployed V5 Git branch, Build Revision, Coolify configuration or service images.

**Only after an authorized operator identifies a previously approved compatible API+Web rollback pair** may the operator add all three optional arguments, with actual exact local IDs, `--rollback-api=sha256:<64hex>`, `--rollback-web=sha256:<64hex>`, `--rollback-source=<40hex>`. The script verifies both images still exist locally, carry the expected revision *label* and match API vs Web image workdirs; it rejects current-image aliases, missing old images, wrong-role images and incomplete triples. Prior historical image IDs found in issue comments are **not auto-approved rollback candidates**. A successful local inventory is still **not** proof of source→image attestation, compatible database rollback, recoverability, signed acceptance or deployment GO.

Output includes only fixed, allowlisted metadata: project, source SHA, per-service local Docker image IDs, boolean metadata matches, registry *digest suffixes* if Docker has them, explicit provenance/rollback acceptance booleans fixed to false, and security reason codes. It never prints `Config.Env`, raw image tags, repository names, host secrets, DSNs or customer data. **`RepoDigests` observed in metadata are not sufficient to prove a trusted signed supply-chain mapping.**

Unreviewed merge/deployment remain prohibited while concurrent Phase 2 owns shared staging. Native tests must complete successfully on the exact changed head. Owner/operations still must archive a trusted build+registry mapping and a signed rollback/state-compatibility decision.

## 6. Accountable decision record — deliberately unsigned

| Decision field | Present evidence | Pending human/immutable artifact |
| --- | --- | --- |
| Security review accountability | Ajay Chaudhary authorized as **owner-led** human risk owner; ChatGPT advisory only | Dated attributable risk-acceptance original, conditions/expiry and restricted evidence locator/hash; **not** independent certification |
| Historical credential exposure (#281) | Scope: six non-API containers; later runtime/environment remediation | Assessed access/exposure window, compromise/no-evidence determination with limitations, key rotation-vs-preservation basis, residual risk disposition |
| Student privacy / tenant/load | Existing synthetic tenant/role and provider-negative regression evidence | BBA-specific privacy/guardian-data scope, tenant/load applicable witness mapping, outside-audit legal/contractual applicability decision |
| Provenance | Staging image IDs and self-reported revision labels; 4/4 latest source CI success | Reproducible build chain, registry digests and accepted image-to-source mapping |
| Rollback / recovery | 29 Oct isolated DB/empty-uploads restore PASS and backups | Known-available older image IDs, coordinated data/state compatibility and media/Vault recovery disposition |
| Human acceptance | Owner has reported internal approval **in principle** | Actual signed scoped acceptance original and exact protected reference; approval intent alone is not a signed gate record |

**Governance:** Do not place a name in a signature line or mark Gate 6/2/3/8 verified without source-attributed evidence. Production promotion and paid-video/live payment collection remain HOLD. This is Phase 1 technical engineering evidence, not a quantified partial gate pass.
