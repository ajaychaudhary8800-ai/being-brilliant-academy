# Adhyay SchoolOS V5 — isolated Coolify staging source attestation

**23 October 2026 · P0 deployment acceptance · production and paid billing HOLD**

This document prepares the **existing dedicated V5 staging** environment for a controlled owner-operated deployment, not a deployment authorization. The application is currently a Draft GitHub stack. Green GitHub integration tests do not mean the updated V5 source is running in Coolify.

## Fixed safety boundaries

- Existing isolated V5 URL: `https://v5-staging.beingbrilliantedu.com`.
- Existing dedicated Coolify application UUID reported in operations docs: `96ffcu0jinuwlnaqxpltln4p`.
- Existing dedicated V5 PostgreSQL database name: `schoolos_v5_staging`; migrations historically 114. Never substitute V4 production or shared `main-staging`.
- Existing V5 Compose: `docker-compose.schoolos-v5-staging.yml`; API Razorpay TEST secrets via API-only root-owned read-only host mount; backup R2 credentials via backup-only root-owned read-only mount. Do not paste or inspect secret values in logs.
- Commercial release manifest: `declaredStatus=HOLD`; **ten gates PENDING**, including payment, authenticated UAT, provider/AI, backup, finance/legal and final production owner signoff.
- **Never use** `.github/workflows/staging.yml`: it deploys legacy shared staging and explicitly rejects V5. **Never use** `deploy.yml` or a `v5.*` production tag for this step.

## Stage 1: immutable source and automated evidence (no host work)

1. Review the cumulative Draft PR dependency tree and freeze one application source SHA, followed only by permitted release-manifest metadata. Verify the chosen source is an ancestor of the exact manifest HEAD.
2. Require **all four exact-head** workflows to complete SUCCESS: full CI including Docker Compose, isolated V5 disposable PostgreSQL sandbox, external staging public GET/browser read-only QA and synthetic V4→V5 restore. Do not confuse a green public GET check with proof that the candidate is deployed.
3. Obtain reviewer confirmation of current environment services, backup digest, credential-file boundaries and rollback image digest. **No implicit production authorization** from those confirmations.
4. Confirm the running image and DB are already using the isolated Coolify V5 instance. Never create a new Compose project or rename data volumes merely to simplify the source update.

## Stage 2: protected V5-only operator deployment (NOT performed by this PR)

Only after explicit approval for the existing isolated V5 staging resource:

- Preserve current V5 API/Web container image IDs, source revision, the verified latest R2 backup and rollback reference; archive evidence without database users, passwords, JWTs, private keys, tokens or documents.
- Select the exact reviewed cumulative Git HEAD, not a mutable `main` or a legacy `v2-release-candidate-*` branch. Preserve current isolated V5 Docker Compose file, service/volume names, Docker project identity, database host and domain. Do not clear the existing staging database or reset Admin accounts.
- Set the **V5-only Compose build argument** `SCHOOLOS_BUILD_REVISION` to the reviewed 40-character *application source* SHA, using an approved Coolify V5-only environment variable. Default `unattested` is intentionally rejected by the audit. Web and API images claim this revision through `org.opencontainers.image.revision`. **A Docker label is operator-supplied and forgeable**, so retain the actual build source, SHA and image digest from reviewed build logs as independent evidence.
- Deploy *only* the existing V5 staging Coolify application. Abort on failed migrations/service health and use the preserved V5-only rollback path; database migrations cannot safely be reversed merely by rolling back a Docker image. No production/shared staging mutation.
- Preserve TEST Razorpay mode and all **paid admission/settlement** flags disabled. No signed customer order, external payment, production DNS, AI/LiveKit release or email/SMS bulk activation is part of this stage.

## Stage 3: sanitised running-container inventory (read-only)

On a trusted machine with access to **Docker on the V5 staging host**, using the reviewed checkout that contains the script, and after verifying the actual Docker project label for the existing Coolify instance, run:

```sh
node scripts/schoolos-v5-staging-provenance.mjs --project=96ffcu0jinuwlnaqxpltln4p --source=REVIEWED_40_CHARACTER_APPLICATION_SHA
```

If the Docker project label differs, inspect only existing labels and pass the confirmed isolated V5 project name. The script refuses `bba-production`, `bba-staging`, and `main-staging`. It invokes **only** `docker ps` and `docker inspect`, never Compose, SSH, API writes, payments, migrations, updates or deletions; it emits image IDs, boolean source-label comparisons, health, isolation failure codes and no secret values, URLs containing user info or tenant identifiers.

### Required outcomes

`status=PASS_TECHNICAL_SNAPSHOT_ONLY`; services API, Web, PostgreSQL, Redis, backup and Nginx present and healthy; API and Web image labels match source SHA; `DATABASE_URL` privately parsed as host `postgres` / DB `schoolos_v5_staging`; `WEB_URL` matches isolated HTTPS staging; `RAZORPAY_MODE=test`; API-only Razorpay protected credential mount and backup-only R2 credential mount **read-only**; no `BACKUP_AWS_*` secrets injected through global environment. Missing/multiple service, nonmatching revision, host mismatch, wrong payment mode or secret leakage => FAIL and independent investigation.

Even if every technical field passes, the report sets `sourceBuildProvenanceIndependentlyVerified=false`, `realProviderTested=false` and `commercialReleaseAuthorized=false`: these may only change through external, independently witnessed source build/provenance, provider and UAT evidence, not by this diagnostic.

## Stage 4: operator-verified business preflight (read-only)

Once exactly the reviewed image is running and attested with nonsecret IDs, use the **already authored** isolated-staging API script from the *correct reviewed image*:

```sh
node dist/src/scripts/schoolos-v5-commercial-preflight.js
```

The preflight refuses any non-isolated database, expects `WEB_URL=https://v5-staging.beingbrilliantedu.com`, `RAZORPAY_MODE=test`, and reads **only** four plan configurations and historical quotation/invoice counts. It never changes pricebook rows, creates orders or flags paid release ready. **Important:** the container runtime may not include `tsx` / TypeScript source; verify how the exact reviewed staging API image exposes this script before attempting. If absent, do not improvise a production Prisma command or bypass isolation—package a separately reviewed, runtime-compatible read-only entrypoint.

Required owner observations include previously known staging price drift (Essentials ₹49,990 vs approved ₹49,900; Growth ₹89,990 vs approved ₹99,900, subject to fresh evidence), Professional historical TEST invoice preservation, plan custom quoting, SMTP/LiveKit/Razorpay credential-presence booleans (not connectivity) and no paid billing authorization.

## Stage 5: commercial pilot only after separate approvals

Use a dedicated authorized QA-only institution and independently verified signed Order Form for real Razorpay TEST positive settlement/negative replay, refund and dispute; test AI Examiner/LiveKit with real provider webhook and metered cost; repeat encrypted offsite backup + Vault key recovery; complete classroom/teacher/admin/guardian UAT and product support rehearsal. Finance resolves onboarding included-vs-estimate contract conflict, Enterprise/custom add-on tariffs and 60-day pilot payment terms. Independent release gate evidence and written owner production authorization are mandatory.

**State of this PR:** all steps described are preparations and checks; no SSH, Coolify deployment, database write, provider activation, live billing, external contract or actual customer onboarding performed.
