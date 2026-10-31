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
