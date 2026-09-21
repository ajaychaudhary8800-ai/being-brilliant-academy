# Automated staging QA

The Playwright suite validates public access, authentication, role routing, admin modules, teacher assessment isolation, student work, parent results, employee access, responsive rendering, and common server-error states.

## Safety model

- Full workflow mutations are permitted only on the isolated staging QA organization.
- `beingbrilliantedu.com` is hard-blocked from mutation tests.
- Production should run read-only smoke tests only.
- Credentials belong in GitHub Actions secrets, never source control.
- Failure screenshots, traces, videos, and JUnit results are retained for 14 days.

## Required GitHub Actions secrets

`QA_BASE_URL`, `QA_ORGANIZATION_SLUG`, and email/password pairs for `SUPER_ADMIN`, `BRANCH_ADMIN`, `ACCOUNTANT`, `TEACHER`, `STUDENT`, `PARENT`, and `EMPLOYEE`.

The dedicated organization slug should be `automated-qa-academy`. Use synthetic names, phone numbers, fees, marks, and documents only.

## Local execution

Copy `.env.qa.example` to a private environment file, export the variables, then run:

```bash
pnpm exec playwright install chromium
pnpm test:e2e:smoke
```

The scheduled workflow runs daily at 03:00 Asia/Kolkata (21:30 UTC).
