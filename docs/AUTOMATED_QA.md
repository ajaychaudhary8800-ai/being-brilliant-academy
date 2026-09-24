# Automated staging QA

The Playwright suite validates public access, authentication, role routing, admin modules, teacher assessment isolation, student work, parent results, employee access, responsive rendering, common server-error states, and real cross-role academic workflows.

## Safety model

- Full workflow mutations are permitted only on the isolated staging QA organization.
- `beingbrilliantedu.com` and `www.beingbrilliantedu.com` are hard-blocked from mutation tests.
- Mutation tests require both `QA_RUN_MUTATION_TESTS=true` and `QA_ALLOW_MUTATIONS=true`.
- Production should run read-only smoke tests only.
- Credentials belong in GitHub Actions secrets, never source control.
- Failure screenshots, traces, videos, and JUnit results are retained for 14 days.

## Required GitHub Actions secrets

`QA_BASE_URL`, `QA_ORGANIZATION_SLUG`, and email/password pairs for `SUPER_ADMIN`, `BRANCH_ADMIN`, `ACCOUNTANT`, `TEACHER`, `STUDENT`, `PARENT`, and `EMPLOYEE`.

The dedicated organization slug should be `automated-qa-academy`. Use synthetic names, phone numbers, fees, marks, messages, attendance and documents only.

## Required staging fixture relationships

The workflow suite discovers IDs dynamically instead of storing database IDs in GitHub. Keep these relationships valid in the synthetic QA organization:

- the QA teacher has an active teacher profile and an active subject allocation;
- the QA student is active in one of that teacher's allocated batches;
- the QA parent is linked to that QA student;
- the QA student's batch has at least one published LMS lesson;
- the current date is inside the student's active academic enrollment and the teacher is allowed to mark attendance for that batch.

The workflow creates a uniquely named homework, publishes it, submits it as the student, evaluates it as the teacher, verifies the result through parent and student portals, exercises two-way teacher/student messaging, advances LMS progress, validates attendance, then archives the synthetic homework. Re-running on the same day reuses an existing attendance record instead of creating a duplicate.

## Local execution

Copy `.env.qa.example` to a private environment file and export the variables. Read-only smoke QA:

```bash
pnpm exec playwright install chromium
pnpm test:e2e:smoke
```

Full staging workflow QA requires the isolated QA tenant:

```bash
QA_RUN_MUTATION_TESTS=true QA_ALLOW_MUTATIONS=true pnpm test:e2e:workflow
```

The scheduled GitHub workflow runs both smoke and guarded workflow QA daily at 03:00 Asia/Kolkata (21:30 UTC).

## Authentication strategy

Staging protects `/api/v1/auth/login` with a 15-minute login rate limit. The nightly suite therefore authenticates each configured QA role exactly once, stores the resulting Playwright browser state under `test-results/qa-auth`, and reuses/rotates those sessions for the remaining smoke and workflow checks. The saved state is ephemeral CI output and must never be committed.

The nightly commands run with one worker and zero retries around authentication so a transient assertion cannot create a login retry storm. API workflow checks refresh the saved role sessions through `/auth/refresh`, which does not consume another login attempt.

For ad-hoc staging QA, prefer the same sequence: run `e2e/auth.setup.ts` once, then set `QA_REUSE_AUTH_STATE=true` for role/navigation and workflow specs. Do not run the complete legacy `@smoke` login matrix repeatedly against staging, because it can intentionally trigger the security limiter.
