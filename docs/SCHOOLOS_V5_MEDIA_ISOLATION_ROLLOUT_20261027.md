# SchoolOS V5 — controlled media-secret isolation deployment (27 October 2026)

**Environment:** V5 staging Coolify project `96ffcu0jinuwlnaqxpltln4p` only.
**State:** REVIEW REQUIRED / release HOLD. No V4 production operations and no paid-video activation.

## Confirmed evidence
Owner's read-only Docker inventory showed six healthy V5 services and API/Web image revision labels at `93c2b1d58c4c881f69d74760c3f531049bf686f3`. Existing project volumes are:
- `96ffcu0jinuwlnaqxpltln4p_postgres-data`, PostgreSQL target `/var/lib/postgresql/data`
- `96ffcu0jinuwlnaqxpltln4p_redis-data`, Redis target `/data`
- `96ffcu0jinuwlnaqxpltln4p_app-storage`, same named volume for API and backup at `/data/storage`
- `96ffcu0jinuwlnaqxpltln4p_backups`, backup target `/backups`

All reported Docker volume project labels matched. Existing persistence was **not** missing. New staging audit accepts precisely project-scoped underscore or hyphen aliases; it does not create/migrate/rename a volume.

LiveKit API and recording-storage credential **values** were present in Nginx, Web, Backup, PostgreSQL, Redis, and API. Only the API needs them. Treat old keys as exposed to an overly broad container trust boundary; plan rotation after successful isolation.

## Controlled implementation

1. **Pre-deployment:** retain verified offsite DB/files/Vault backup and current V5 application rollback image/source. Securely stage a root-owned `0600` file at `/etc/schoolos/v5-staging/livekit-v5-api.env` (parent `0700`). Values must be supplied via a secure host-side method, never Git, terminal echo, chat, or Coolify logs. This file must contain the literal nonempty entries for `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_RECORDING_S3_BUCKET`, `LIVEKIT_RECORDING_S3_ENDPOINT`, `LIVEKIT_RECORDING_S3_ACCESS_KEY_ID`, and `LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY`. Include `LIVEKIT_RECORDING_S3_REGION` and `LIVEKIT_RECORDING_PREFIX` only when nonempty. Do not use `export`, shell substitutions or multiline secrets in the file. The entrypoint deliberately parses literals without `source` or `eval`.
2. **Inspect V5-only deployable Compose:** the API has exactly one read-only bind `/etc/schoolos/v5-staging/livekit-v5-api.env:/run/secrets/schoolos-v5-livekit-api.env:ro`. No other service has that mount. The API entrypoint requires an existing, readable, complete file and fails closed.
3. **Critical Coolify step:** remove the *four sensitive media variables* from **all globally attached V5 Coolify environments/duplicate entries**: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_RECORDING_S3_ACCESS_KEY_ID`, `LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY`. The file remains the API credential source. Delete no V4 configuration. Do not merely set these variables to empty: old observations showed global env-file precedence. Keep non-secret media configuration from the private file as needed.
4. **Preserve pre-existing volumes:** compare rendered V5 Compose against actual current mounts and project label. **The reviewed V5 staging Compose now pins all four observed hyphenated volume names as `external: true`; they must already exist.** DO NOT deploy if the rendered preview differs or would create new volumes. Do not change any external-volume names or use the staging Compose on production. Do not use `docker compose down -v`, `docker volume rm`, prune, volume renames or automatic reinitialization.
5. Deploy only the approved V5 staging source. Verify all six services healthy, API/Web pinned revisions, migrations and storage mounts. Inspect running **and stopped** project services for nonempty media secrets; only API may contain them. Check the existing R2-only backup and Razorpay API secret mounts remain read-only and scoped.
6. Authenticate to synthetic staging teacher/student accounts. Verify actual LiveKit class issuance, connectivity, recording to private object storage, enrolled LMS playback/download and cross-tenant denial. Keep paid video flags disabled.
7. Rotate both LiveKit provider credentials and recording-storage credentials through their respective provider consoles after the mount migration works. Replace the protected file without printing secrets, redeploy V5 staging only, retest, and revoke old credentials. Independently check backups, Cloudflare R2 and monitoring. Do not infer theft from scope exposure alone.

## Verification boundary
The hardened `scripts/schoolos-v5-staging-provenance.mjs` checks six services, exact project-prefixed persistence names, matching API/backup upload mounts, configured API-only provider file, API/Web labels, shared backup credentials, payment file and TEST-only mode. It does not independently establish build reproducibility, full offsite restore, real customer acceptance or legal/finance signoff.

**No deploy, rotation, offsite restore or contract signoff is claimed by this source change.** Formal commercial release gates remain HOLD until fresh post-deploy evidence is independently reviewed.
