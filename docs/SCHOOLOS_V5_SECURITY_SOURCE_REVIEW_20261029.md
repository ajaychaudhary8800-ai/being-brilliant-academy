# SchoolOS V5 security review — exact-source evidence and residual controls
**29 October 2026 · PRELIMINARY SOURCE / EVIDENCE REVIEW · NOT SIGNED SECURITY ACCEPTANCE**

## Immutable scope
- Application source commit: `c8c80151b6f0919552d60c5cb71af1b92d319ff5`; cumulative Draft PR #262. Security fix PR #276 was merged **into V5 development only**. V4 production `main` is not in scope.
- Isolated staging Docker Compose project: `96ffcu0jinuwlnaqxpltln4p`; approved staging origin: `https://v5-staging.beingbrilliantedu.com`.
- Four exact-source workflows independently queried from GitHub at that SHA: CI `40549283311`, isolated sandbox `40549283373`, external read-only/browser QA `40549283315`, isolated upgrade rehearsal `40549283325`; **SUCCESS**. These are software tests, **not** signatures, image-build attestation, or live provider verification.
- Review sources: `docker-compose.schoolos-v5-staging.yml`, `apps/api/docker-entrypoint.sh`, `scripts/schoolos-v5-staging-provenance.mjs`, `scripts/check-schoolos-v5-media-file-credentials.test.mjs`, `scripts/schoolos-v5-staging-provenance.test.mjs`, and the retained staging rollout document (all at exact SHA above).

## Reviewed controls and their limits

| Control | Source-level outcome | Boundaries / evidence |
| --- | --- | --- |
| LiveKit and recording R2 secrets | **IMPLEMENTED**: only API service binds host `/etc/schoolos/v5-staging/livekit-v5-api.env` to the API-only, read-only container path; shared migration/API Compose anchor excludes media secret mappings. | A Docker Compose source review does not prove Coolify has no later global env injection. Operator later reported all four media values absent from Docker `Config.Env` for running/stopped project containers. |
| API secret loader | **IMPLEMENTED**: accepts specific literal media keys, rejects missing/empty/duplicate/unrecognized entries, never shell `source`s or `eval`s the media file. | Root-readable protected file and process env remain sensitive. This is deliberate API runtime handling, **not encryption at rest**. |
| Existing data volumes | **IMPLEMENTED**: four project-scoped pre-existing external named volumes pinned; API and backup share application storage. | No destructive volume operation is required or authorized; mount identity is not full integrity proof. |
| Other protected provider mounts | **IMPLEMENTED**: API-only Razorpay protected file and backup-only R2 credentials file; runtime audit checks scope and read-only mount shape. | Verify actual Coolify scope; no new rotation required for the media keys already rotated on operator evidence. |
| Runtime read-only audit | **IMPLEMENTED**: Docker `ps`/`inspect`; checks service health, V5 DB and origin, TEST payment mode, video admission/settlement flags OFF, volume and provider mount scope, non-API four media credentials absent. | Image revision labels are self-reported metadata; independent build provenance and actual runtime output remain separately attributable evidence. |
| Rotated credentials | **OPERATOR-REPORTED COMPLETE 28 OCT**: replacement LiveKit provider authentication, recording R2 synthetic write/read/delete, four API process-key matches, old LiveKit/recording token revocations confirmed by owner. | Not an independently witnessed provider revocation or retrospective exposure assessment. Repeating rotation solely to obtain a signature is not required. |

## New targeted reviewer observation — migration environment overbreadth

In the **reviewed application source**, `docker-compose.schoolos-v5-staging.yml` still defines `x-api-env: &api-env` with numerous non-database API credentials, including `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AI_API_KEY`, `SMTP_PASSWORD`, `TWILIO_AUTH_TOKEN`, `WEB_PUSH_PRIVATE_KEY`, `PAYMENT_CREDENTIAL_ENCRYPTION_KEY` and `COMMERCIAL_DOCUMENT_ENCRYPTION_KEY`. The **one-shot `migrate` service uses `environment: *api-env`**, whereas `apps/api/scripts/prisma-run.mjs` forwards its environment to the Prisma CLI for `migrate deploy`. The database migration command appears to need `DATABASE_URL`, not all these API runtime secrets.

**Classification: LEAST-PRIVILEGE REVIEW REQUIRED (not verified live leakage).** Source mapping creates the possibility of non-media credentials being inherited by the migration container when configured nonempty. Actual current Coolify injection, the contents of stopped `migrate` `Config.Env`, and any migration-specific need for those secrets were **not inspected in this checkpoint**. The existing media-specific runtime guard does not establish absence of this other set. A reviewer should scope a **separate minimal migration env** (typically `NODE_ENV` + `DATABASE_URL` after validated execution), add targeted source/run-time regression, and confirm Coolify does not independently propagate globally configured values. Do **not** blindly remove variables or redeploy merely on this observation. No secrets or values should be displayed; require only safe key presence/mask metadata. This is a *new finding*, distinct from the four-media-key remediation completed on operator evidence.

## Remaining security acceptance (gated)

1. **Source/image provenance:** named independent reviewer connects immutable application SHA to specific source checkout, staging build record and image digests. A matching OCI revision label alone is not proof.
2. **Credential boundary:** review the non-media shared migration env finding, determine necessity and remediation; privately audit key-presence on non-API containers and stopped migration without printing values. Confirm media revocation evidence and any historical exposure disposition. No repeat media rotation absent a specific finding.
3. **Tenant/role/privacy:** attribute existing synthetic cross-branch/coaching, school restriction, unauthorized tenant, recording download authorization, role and audit evidence. Obtain only missing genuine staging/privacy/load acceptance and identify material untested cases.
4. **Provider/video controls:** V5 paid-video admission/settlement/zero-release remain disabled. Operator confirmed source/provider/recording QA previously; retain original artifacts and witness without authorizing billable workflows.
5. **Independent signoff:** actual reviewer identity, role, date/time UTC, exact source SHA/deployed digests, relevant artifacts, exceptions, decision, remediation/compensating-controls owner and review date. Do not fabricate signatures or treat this memo as gate `VERIFIED`.

## Decision boundary

**Gate 6 = PENDING; commercial production GO = HOLD; issue #275 remains OPEN for independent disposition.** This review causes no infrastructure, database, tenant, provider or production mutation. If an additional engineering fix is approved, it must be developed on the isolated V5 branch, pass exact-head CI, be reviewed and only then deployed to existing isolated V5 staging with an approved rollback; never silently alter frozen V4 `main` or claim release readiness from an AI-authored assessment.
