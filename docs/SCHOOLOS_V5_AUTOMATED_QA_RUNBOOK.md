# Adhyay SchoolOS V5 — automated QA as default

## Scope and release safety

Automated QA is the default verification path for V5 Draft pull requests. The separate
V4 production environment must remain frozen and untouched. The pinned externally deployed
V5 candidate is `db98846175fce528751b5df415b4ef46af777a70`; changes to
this PR **do not deploy** or replace that commit in Coolify.

QA and production promotion are distinct. Even when all machine jobs are green,
`config/schoolos-v5-release-gates.json` retains HOLD until independent human approvals.

## Automatic checks

Workflow: `.github/workflows/schoolos-v5-external-staging-qa.yml`

The workflow automatically runs for relevant changes to a V5 Draft PR and offers
manual `workflow_dispatch` for rechecks. It has two independent jobs:

1. **External V5 staging smoke (read-only)**:
   - Confirms live staging home, admin login, readiness and operational URLs answer HTTP 200.
   - Confirms anonymous callers cannot enumerate platform organizations or batches.
   - Optionally authenticates a *dedicated staging-only* platform test account and confirms
     `schoolos-qa-coaching` and `schoolos-qa-school` exist.
   - Writes redacted results to a GitHub Actions artifact, marked PARTIAL if credentials absent.
   - Allowed methods: GET and optional POST *only to the login route*. Never seeds or deletes data.

2. **Disposable PostgreSQL coaching regression**:
   - Uses freshly created PostgreSQL 16 and Redis 7 services on GitHub-hosted infrastructure.
   - Applies all 114 migrations; fails if applied count does not equal 114.
   - Executes `academic-placement-concurrency.integration.test.ts` against a local-only
     `TEST_DATABASE_URL` with real authenticated Express HTTP and Prisma queries.
   - Exercises coaching cross-branch teacher assignment, grade 5/6/7 admission constraints,
     cross-tenant denial, school-only restrictions, timetable races, and academic placement.
   - Asserts commercial gates are still HOLD.
   - This is isolated regression evidence, **not** live staged customer UAT.

The existing V5 isolated sandbox workflow, CI, and upgrade rehearsal remain in effect.
Do not duplicate their full build workload on the shared VPS.

## Initial staging observations (owner supplied 20 October 2026)

- V5 staging website, API ready, and API operational: HTTP 200.
- Separate V5 PostgreSQL database `schoolos_v5_staging`: 114 migrations applied.
- Initial admin login and dashboard: confirmed through user-driven browser session.
- Synthetic QA institutions `schoolos-qa-coaching` and `schoolos-qa-school`: created.
- Institution administrator setup email did not send because SMTP is not configured.
- Full live authenticated student/teacher/branch UAT: NOT YET VERIFIED.

## One-time credentials for expanded authenticated external QA

To enable the optional authenticated external checks, configure encrypted **GitHub Actions
repository secrets**: `SCHOOLOS_V5_QA_EMAIL` and `SCHOOLOS_V5_QA_PASSWORD`.
Use a **new dedicated QA-only account created exclusively inside V5 staging**. Never use
the primary/owner/production administrator login. Never put passwords in scripts, commits,
chat transcripts, screenshots, issue comments, or artifacts. Repository secrets cannot be
read back by the workflow. Limit workflow permissions to `contents: read`.

If either secret is absent the external job reports `PARTIAL_PASS_AUTH_REQUIRED`
and **must not** be claimed as authenticated UAT.

The 24 coaching staging UAT scenarios are listed separately in
`docs/SCHOOLOS_V5_COACHING_STAGING_UAT.md`. Actual customer/UAT signoff, offsite
backup/restore, third-party payment/video provider validations, browser/mobile workflows,
and release authorization remain independent gates.

## Owner workflow from now on

1. Development lands on isolated V5 feature/Draft PR branches, never directly on V4 main.
2. GitHub automatically tests changed candidate code and produces machine evidence.
3. CI failures are fixed in Draft PRs; green jobs are not treated as commercial approval.
4. Privileged live staging mutations use approved dedicated QA identities and fixtures
   only after evidence, safeguards, and credentials have been configured.
5. Human actions are reserved for one-time credentials, paid-provider setups,
   customer acceptance/signoff, and final explicit production release approval.
