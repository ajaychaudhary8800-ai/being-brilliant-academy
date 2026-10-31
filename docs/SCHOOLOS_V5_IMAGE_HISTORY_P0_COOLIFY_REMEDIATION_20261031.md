# SchoolOS V5 P0 — Coolify build-argument secret exposure remediation (31 October 2026)

**Scope**: isolated V5 staging project only. Technical owner: Ajay Chaudhary (internal owner/operations review), ChatGPT engineering advisory. Issues: [#293](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/293), [#292](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/292), [#258](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/258).

## Confirmed P0 / non-claims

The staging API and Web **both** contain nonempty `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and `DATABASE_URL` assignment patterns in image build history, according to the owner's no-values read-only VPS scan. Earlier (valid) six-non-API runtime environment isolation does **not** protect image metadata. The owner also supplied raw Windows diagnostic output with credential material inadvertently displayed. Treat that output, image archives and any Docker histories as **restricted incident artifacts**. Do not copy raw evidence to PRs, GitHub comments, CI logs, chat or public file storage.

The deployed Web history includes a large BuildKit `RUN |N` build-argument assignment expansion, consistent with automated build-argument injection. **Source of that injection is not independently proven**; inspect Coolify settings before concluding root cause. The V5 repository Compose source uses only the intentional `SCHOOLOS_BUILD_REVISION` API build argument and `NEXT_PUBLIC_API_URL` plus `SCHOOLOS_BUILD_REVISION` Web build arguments. Do not confuse Compose runtime/interpolation environment with Dockerfile build arguments.

This exposure is **not proof** of unauthorized use, V4 production involvement, or compromise of keys that tested `NO` by a limited history audit.

## Stage 0 — containment and non-mutating preflight, no staging lock needed

1. Restrict the raw Windows diagnostic log, locally archived current API/Web tar copies, V5 registry permissions and Coolify build logs to authorized incident responders. Do not delete original evidence until necessary minimum-forensics retention is documented. The preserved image tar is *credential-bearing* and **not** a clean rollback artifact.
2. In Coolify, identify the **specific V5 staging Git-based Docker Compose application** and confirm exact project `96ffcu0jinuwlnaqxpltln4p`. Never modify V4 production `main`, another application, or an apparently similar service. Record only boolean settings, key **names**, and whether the build is managed by Coolify (not any values or screenshots with values).
3. Under **Advanced → Build**, review **Build arguments**. For Git-based Docker Compose, prefer **Managed manually in Dockerfile** so Coolify cannot blindly forward all application variables as build arguments; the Dockerfile must explicitly declare and consume its narrowly necessary arguments.
4. Under **Environment Variables**, review the build-time flag for `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, `JWT_*`, payment, SMTP, LiveKit, backup, Vault, token and other credential names. These should **not** be available during the image build. Keep legitimate runtime or Compose interpolation assignments correctly configured; do not delete values, rotate them, or casually switch the runtime flag. The normal variable default is `buildtime=true`; run-time scope is an independent flag.
5. Verify that no **Custom Build Command** (including generated `--build-arg KEY=VALUE` flags), Dockerfile `ARG SECRET`, CI, or injected `build.args` override bypasses the intended allowlist.
6. Preserve a redacted setting inventory and review owner access to registry, tar, build logs and Coolify resource roles. The precise blast radius is still unknown.

Coolify docs (checked 31 Oct 2026): https://coolify.io/docs/applications/configuration/environment-variables and https://coolify.io/docs/applications/builds/docker-compose. Docker docs: https://docs.docker.com/build/building/variables/ and https://docs.docker.com/build/building/secrets/.

## Stage 1 — change preparation (NOT a deployment authorization)

- Restrict the build arguments to exactly `SCHOOLOS_BUILD_REVISION` for API, and `NEXT_PUBLIC_API_URL` plus `SCHOOLOS_BUILD_REVISION` for Web. If other build-time inputs are genuinely necessary, review individually and prove they contain no secrets. Source arguments are not a permission to forward runtime secrets.
- Configure Coolify **Build arguments = Managed manually in Dockerfile** and **Build time = Not available during build** for every secret. Operator captures only names and setting statuses. Settings must be reviewed for V5 only; apply without triggering any deployment while Phase 2 uses staging.
- Test an isolated, deliberately synthetic build using an independent Docker context and disposable placeholders; inspect image **history**, image-level `Config.Env` and potentially secret-bearing layers with values never printed, using a restrictive scanner and manual review. A clean history-only result does not prove layers are clean. Do not use current live credentials in the proof build.
- Pin build revision, source, Dockerfile, BuildKit version, immutable image IDs/registry digests and the evidence of clean metadata. Stage and verify approved previous image or same-version repair recovery plan in a separate environment.

## Stage 2 — authorized staging maintenance only, after Issue #258 lock transfer

**Conditions before any redeploy or credential rotation**:
- Phase 2 releases shared staging lock; owner approves exact new source SHA, clean API/Web images, recovery assets, work window and rollback/restore strategy.
- Retain verified 29 Oct offsite DB restore record and current backups; evaluate schema/data compatibility and scope of exposed image archives. Previously exposed images are **not** a clean rollback route.
- DB/Redis rotation plan identifies ALL consumers: PostgreSQL service and database role(s), API, backup, stopped migrate job, Redis service, API Redis client, cache/session behavior, health probes, and any other workers. Test credential parity and backups. Redis password also appears in service command arguments; review host access boundary separately.
- During approved service window, atomically coordinate fresh DB and Redis credentials, protected provider/config files, generated Compose and live services. Fail closed if any consumer is left pointing at old credentials; do not rotate Vault payment/encryption/JWT keys as an incidental step.
- Test isolated clean image artifacts, then verify current staging /health readiness, authenticated internal BBA flows and backup monitor, without needlessly repeating prior full V4 tests. Record *actual* staging observed result; do not equate CI success to deployed image clean.

## Stage 3 — follow-up and gate decisions

- Confirm old credential invalidation and incident/access log review with limitations. Rotate only confirmed exposed credential families based on scoped risk, after investigating any production reuse.
- Retain restricted original evidence separately from publishable sanitized incident summary, and document access/expiry, including Windows artifact handling.
- Obtain human-attributed, dated owner-led residual-risk acceptance. Do not describe owner self-review as independent security certification.
- Image history absence **alone** does not close Gate 6; require source→build→registry→deployed attestation, full recovery strategy and privacy/tenant/load acceptance. Paid commercial GO stays HOLD until independently evidenced release board gates are closed.

### Last known status
- Deployed staging SHA label: `b54dca5ae36a948f83012faa4a37354198fba083` (self-reported, not signed build attestation).
- Phase 1 source-only no-values audit guard: Draft PR #291, unmerged/undeployed.
- P0 #293 **OPEN**. No credentials rotated, images rebuilt or staging deployment authorized by this document.


## Additional exposure-scope check — Nginx and backup custom images

The P0 finding is **directly observed only in API and Web** so far.
The Compose file also builds the `nginx` and `backup` images
locally, and both could have inherited Coolify's build-variable injection.
Do **not** assert these images are clean without operator-observed results.
The single-stage `migrate` service uses the API image (already covered).
PostgreSQL and Redis use upstream images, not this repository's custom build
path, although their **runtime** configuration requires separately reviewed
credential handling.

The Phase 1 read-only provenance script now checks metadata build history
and image-level `Config.Env` for **all four local custom-build service
images**, with a false-negative-prevention veto if any image cannot be
inspected. Nginx and backup have no required repository revision label,
so their identity is pinned by the running container's image ID; this is
still self-reported metadata, not a signed supply-chain attestation.
Native tests use synthetic credentials only. **No actual Nginx/backup
Docker history output has been observed yet**. Reuse the current security
audit without repeating previous successful backup or LiveKit/UAT checks.
Only report secret-key NAMES and YES/NO flags — never Config, image history,
service environment, generated `.env`, URL credentials or raw Docker logs.


## 31 Oct V2 operator audit — actual literal/empty classification in all four images

The owner successfully executed the live staging V5 **read-only** V2
history-classification script. The seven-container project inventory passed,
and API, Web, Nginx and Backup histories were all readable and classified.
**Each of the four custom image build histories contains nonempty literal
or expression assignments for exactly these three relevant key names**:
`DATABASE_URL`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`. Each image also
contains nine **explicitly empty** assignments for the narrower checked
credentials: `AI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`PAYMENT_CREDENTIAL_ENCRYPTION_KEY`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`,
`WEB_PUSH_PRIVATE_KEY`, `WHATSAPP_ACCESS_TOKEN`.
Each image-level `Config.Env` had no nonempty protected names observed.
Large BuildKit argument expansion: API YES, Web YES, Nginx NO, Backup YES.
Unknown reference-classified values: NONE in this checked key set.
The script printed no values, made no changes, and did **not** scan complete
filesystem layers. See incident #293 for the sanitized source evidence.

**Precision:** This is an image build-history *assignment format*
classification, not independent proof the bytes are valid/current runtime
credentials. PostgreSQL and Redis credential families warrant controlled
rotation regardless because the earlier raw Web metadata diagnostic
inadvertently displayed credential-like plaintext. Empty history values for
the other nine names do not prove those services have no exposure elsewhere.
Nginx and Backup are now **confirmed in scope** for the clean-image rebuild.

## Post-clean-image controlled maintenance protocol — NOT approved to execute

### A. Immutable preconditions
1. Identify the **exact** shared V5 staging Coolify resource and record
   the approved Git SHA, Compose digest, four custom image IDs, six
   persistent service identities, named volumes, protected runtime-file
   mounts and existing API/Web revision. No guessed values.
2. Phase 2 explicitly releases the shared-staging lock on #258. Record
   an owner-approved change window, operator, recovery strategy and
   abort criteria. PR #291 remains isolated until the change is reviewed.
3. New clean build must use **only the nonsecret allowlisted** Dockerfile
   inputs. Inspect Docker history, final image `Config.Env`, labels and
   evidence of image-layer content where feasible for **all four images**,
   with no secret values in logs. Publish immutable private registry
   digests/source build chain only after review. Retain the four known
   current-image digests as **restricted emergency forensics**, not clean
   rollback evidence.
4. Preserve a current verified offsite DB backup with migration/version
   manifest, uploads/recordings scope and protected encryption-key custody.
   The 29 October isolated restore proves historical snapshot recovery,
   **not** a new just-before-change checkpoint; do not repeat expensive
   historic tests without necessity, but verify the new checkpoint.
5. Review all actual PostgreSQL and Redis consumers before changing
   credentials: postgres role/password, `POSTGRES_PASSWORD` service
   bootstrap setting, API and migrate `DATABASE_URL`, backup
   `DATABASE_URL`, Redis `--requirepass`, Redis container environment,
   API `REDIS_URL`, Redis healthcheck, and any remaining jobs or
   sidecars. Runtime and protected file mounts are a separate trust
   boundary from image build args.
6. Never store new raw credential values in GitHub issues, CI environment,
   build args, shell history, Docker labels, Dockerfile `ENV`, README,
   local downloaded logs or exported recovery tar.

### B. Coherent staging rotation + clean rollout
1. Announce a V5-only synthetic-staging maintenance window and pause
   test writes/scheduled jobs **only under explicit owner control**. V4
   production must remain untouched.
2. Apply V5-only reviewed Coolify Build arguments = **Managed manually
   in Dockerfile** and build-time access disabled for secrets, without
   suppressing Compose/runtime interpolation needed for services.
3. Build and verify all four clean images from an exact pinned source
   under restricted access, ensuring **no forwarded secret values**.
4. Prepare new PostgreSQL and Redis passwords in protected local secret
   custody; coordinate a controlled transition of existing PostgreSQL
   role authentication with the service environment and all connection
   URLs. Merely changing the `POSTGRES_PASSWORD` Compose value does
   **not** update the password of an existing persisted PostgreSQL role.
   Avoid passwords in terminal arguments or shell history.
5. Coordinate Redis authentication change with `--requirepass`,
   runtime Redis/healthcheck clients, API `REDIS_URL` and restart in
   a reviewed service order. Plan for Redis client session reconnections
   and short maintenance; do not blindly change only one side.
6. Recreate only the V5 application/service containers required by the
   exact approved Compose and newly signed/checked image pins; preserve
   all named volumes and protected-file mounts. No `down -v`, pruning,
   irreversible migrations, rollbacks to unreviewed older application
   schemas, or changes to V4 production.
7. Verify staging readiness and operational endpoints, DB/Redis actual
   login with the **new** credentials, rejected use of the **old**
   credentials, backup/restore integrity for the latest checkpoint,
   application logs without plaintext, the existing BBA UAT fixture
   integrity and the two parallel Phase 2/3 acceptance routes.
8. Rollback/abort if new images contain sensitive history, any credential
   consumer mismatches, wrong tenant/database, readiness 5xx, application
   session failures, Vault file-mount loss, backup monitor failure, or
   schema/volume compatibility uncertainty. **Rollback needs a written
   state-compatible plan**, not automatic use of the former contaminated
   images; restore coordinated DB/volumes/keys only under incident command.
9. After validated cutover, explicitly review and deauthorize old exposed
   credentials and legacy image access/registry history as applicable,
   documenting evidence of acceptance, exception scope, expiry and
   human security/risk signoff. Distinguish existing owner authorization
   from attributable signed signoff and independent review.

### C. Go/no-go boundaries
Clean synthetic CI on #291 and saved Coolify settings do **not** authorize
automatic staging redeployment or live password rotation, even if the owner
previously approved general engineering continuation. Do not close P0
incident #293 or any of the ten release gates until the relevant live
post-change evidence is independently checked and accepted. Commercial
release remains **HOLD**.
