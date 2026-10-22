# SchoolOS V5 RC4 — Controlled staging acceptance

## Executable acceptance completed by this code
The GitHub-hosted workflow provisions temporary PostgreSQL 16 and Redis 7 for the exact reviewed Draft PR head. It applies all 114 migrations, exercises actual authenticated HTTP coaching tests across tenants and branches, validates signed synthetic provider events and fail-closed LiveKit paths, builds API/Web, and checks local HTTP readiness. It publishes a **non-commercial QA artifact**. No external SSH, Coolify, production, shared staging database, real provider keys, customer records, or live payment calls are used.

## What is NOT accepted by the sandbox
An isolated ephemeral runner is not the customer's external staging environment. C01–C24 real account staging acceptance, real cloud LiveKit provider webhooks and network outage tests, Razorpay TEST paid invoice lifecycle, AI Examiner provider end-to-end billing, multi-tenant load/security, off-site backup and operational restore, pricing/legal/finance approval and final owner signoff must each be evidenced independently before any release-ready claim.

## External staging prerequisites and boundaries
Provision a separate V5-exclusive staging domain and independent Postgres/Redis/storage/backups, never reuse the existing V4 production instance or the shared main-staging Being Brilliant tenant. Pin API/Web image digests and release SHA, prove backup+restore first, and apply 114 V5 migrations to a sanitized disposable restore. Run the 24-scenario checklist in docs/SCHOOLOS_V5_COACHING_STAGING_UAT.md with real permissioned teacher/branch/student identities; record redacted responses and reviewer/date. After separate paid-provider TEST approval, verify finance quote/signature, maker/checker billing and provider reconciliation. Keep V5 release-gates HOLD until 10 independent evidence records are signed.

The legacy GitHub staging.yml targets V2 and can SSH-deploy to shared staging when configured; it must not be used to deploy this unapproved Draft V5 RC. The new workflow is PR-only and has contents:read permissions. The first V5 sandbox run does not imply production deployment authorization.
