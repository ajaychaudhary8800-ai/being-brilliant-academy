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
manual `workflow_dispatch` for rechecks. It has three independent jobs (external
HTTP, disposable PostgreSQL, and desktop/mobile Chromium). No privileged QA
credentials are injected into pull-request-controlled code.

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

## Credential and privilege isolation for live authenticated UAT

**Security rule:** Never inject staging platform SUPER_ADMIN credentials into a
`pull_request` job: an untrusted Draft PR can change the test script and disclose
injected secrets. `.github/workflows/schoolos-v5-external-staging-qa.yml` therefore
sets both credential variables to empty strings for all PR and manual workflow runs.
The GitHub-hosted public job intentionally records `PARTIAL_PASS_AUTH_REQUIRED`.
A green public workflow never means authenticated staging UAT passed.

A tightly guarded optional staging QA account bootstrap is provided:

- `apps/api/scripts/schoolos-v5-qa-bootstrap.mjs`
- `apps/api/scripts/schoolos-v5-qa-guard.mjs`
- `apps/api/scripts/schoolos-v5-qa-guard.test.mjs`

It is **not invoked automatically** by CI or on production. It can create or
rotate exactly one synthetic platform QA account
`schoolos-v5-qa-platform@example.test`, only after a human verifies that:
- `WEB_URL` exactly equals `https://v5-staging.beingbrilliantedu.com`;
- `DATABASE_URL` uses PostgreSQL host `postgres`, user `schoolos_v5_user`,
  database `schoolos_v5_staging`;
- the existing default organization is `being-brilliant-academy` and both
  synthetic QA organizations already exist;
- explicit one-time approval flag
  `SCHOOLOS_V5_QA_BOOTSTRAP_APPROVED=ISOLATED_STAGING_ONLY` was supplied;
- the secret is received only on STDIN from a **non-echo private terminal prompt**.

The script hashes the password, revokes old test sessions, records an audit event,
and never prints credentials. It must not receive live user passwords or production
identity information. It is not present on an older already deployed V5 staging
container until the automation PR has been reviewed and that pinned candidate
explicitly deployed to **isolated staging**.

For authenticated **read-only** smoke testing after the manual staging QA
account bootstrap, the approved operator can run
`scripts/schoolos-v5-trusted-staging-auth-qa.mjs` on a trusted local machine
with Node.js 22. The operator must set
`SCHOOLOS_V5_QA_TRUSTED_RUN=OWNER_APPROVED_LOCAL_ONLY` and pass the dedicated
QA password on STDIN from a no-echo prompt. It refuses `CI`/`GITHUB_ACTIONS`,
never writes tokens or secrets to artifacts, and never grants production release
approval. Its automated negative tests run with every QA PR.

For authenticated UAT, use a dedicated trusted manual execution runner or an
approved protected GitHub Environment/workflow from reviewed trusted code,
not this PR workflow. Do not configure repository-wide SUPER_ADMIN secrets into
a PR-executed workflow. Revocation or account disabling is required after
live staging UAT.

The 24 coaching staging UAT scenarios remain independently tracked in
`docs/SCHOOLOS_V5_COACHING_STAGING_UAT.md`. Actual customer/UAT signoff, offsite
backup/restore, third-party payments and video provider checks, and production
release authorization remain separate gates.

## Verified automated baseline

At Draft PR #223 candidate
`ddb959ecb6d9ca5e546fc8190d684b55a91e5857`, all four configured
workflows were green: full CI (1,149 API tests), live external public smoke,
disposable coaching integration, synthetic V4-to-V5 backup-and-restore rehearsal,
and isolated API/Web acceptance. Subsequent modifications require a new
green run on the **new** immutable PR head.

## Owner workflow from now on

1. Development lands on isolated V5 feature/Draft PR branches, never directly on V4 main.
2. GitHub automatically tests changed candidate code and produces machine evidence.
3. CI failures are fixed in Draft PRs; green jobs are not treated as commercial approval.
4. Privileged live staging mutations use approved dedicated QA identities and fixtures
   only after evidence, safeguards, and credentials have been configured.
5. Human actions are reserved for one-time credentials, paid-provider setups,
   customer acceptance/signoff, and final explicit production release approval.
