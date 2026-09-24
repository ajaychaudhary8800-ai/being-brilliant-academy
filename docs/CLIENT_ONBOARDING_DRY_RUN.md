# Step 7 — Client Onboarding Dry Run

This document records the repeatable synthetic dry run used to validate the complete SaaS client onboarding path before a real paying client is onboarded.

## Automated dry-run scenario

The PostgreSQL integration test at `apps/api/src/integration/client-onboarding-dry-run.integration.test.ts` runs only against the dedicated local integration database created by CI.

It validates the following sequence:

1. A platform Super Admin provisions a new synthetic tenant through the production organization-provisioning API.
2. The selected active SaaS plan is attached and the organization/subscription ledger is aligned.
3. Commercial entitlement enforcement is enabled by the normal provisioning flow.
4. The tenant Super Admin is created and activated without requiring a real email provider.
5. The onboarding snapshot starts in `IN_PROGRESS` and exposes the tenant shared login path.
6. The tenant Super Admin creates a real branch/campus through the production branch API.
7. The branch manager account is provisioned; email delivery may safely be skipped in CI.
8. A second tenant and branch are created as isolation controls.
9. The first tenant's branch listing is verified not to expose the second tenant's branch.
10. Data migration is marked `NOT_REQUIRED` for the synthetic no-legacy-data scenario.
11. Client training is marked `COMPLETE`.
12. Go-live approval and target go-live date are recorded through the onboarding API.
13. The computed onboarding state reaches `READY / 100%` with all 7 readiness checks complete.
14. A tenant administrator is verified unable to call the platform-only onboarding endpoint.
15. Audit evidence is verified for organization creation, branch creation, and onboarding completion.
16. All synthetic records are removed after the test.

## Readiness checks proved

The dry run proves the platform's required onboarding checks:

- Organization active.
- Subscription valid and ledger aligned.
- Tenant Super Admin activated.
- At least one active branch/campus.
- Migration complete or not required.
- Training complete or not required.
- Go-live approved.

## What remains external

This dry run intentionally does not pretend to prove infrastructure outside the application database:

- Client-controlled DNS changes.
- TLS issuance for a real custom domain.
- Real SMTP inbox delivery.
- Real Razorpay payment settlement.
- Off-site backup and isolated disaster-recovery restore.

Those items require their respective production integrations. Step 5 remains the control for off-site backup and disaster recovery.

## Release use

The dry-run test is part of the normal API test command and therefore runs in the protected CI `verify` job with `RUN_POSTGRES_INTEGRATION=1`. A failed onboarding transition, cross-tenant leak, authorization regression, migration failure, typecheck failure, build failure, or container failure blocks merge.
