# RC1 staging validation

This runbook applies to the V2 release-candidate branch. It does not authorize production deployment.

## RC integration rule

The release-candidate tree must include both:
- the fully validated `v2-development` history; and
- the current live `main` hotfix lineage.

Conflicts are resolved in favor of the stronger V2 implementation only after verifying the live hotfix intent remains present. RC1 additionally preserves the production branch-code scoping migration and isolated Compose project naming.

## Automated gates

The normal pull-request CI must pass on the exact RC integration head:
1. existing migration deploy;
2. fresh PostgreSQL migration chain;
3. full API + PostgreSQL integration suite with zero failures/skips;
4. typecheck;
5. production build;
6. runtime readiness smoke;
7. Docker Compose validation;
8. API image build;
9. Web image build.

After merge into a branch matching `v2-release-candidate-*`, the staging workflow:
- re-runs typecheck/build/Compose validation;
- publishes immutable `rc-<sha>` API and Web images to GHCR;
- deploys to the protected GitHub `staging` environment only when repository variable `STAGING_DEPLOY_ENABLED=true`.

## Staging environment requirements

Configure the protected GitHub `staging` environment with:
- `STAGING_DEPLOY_HOST`
- `STAGING_DEPLOY_USER`
- `STAGING_DEPLOY_SSH_KEY`
- `STAGING_GHCR_TOKEN`

The staging host checkout must exist at `/opt/bba-staging` with a protected `.env.staging`. Use a separate database, Redis volume, upload storage, backups and domain from production.

## Mandatory staging smoke matrix

Verify with staging-only test identities:
- SUPER_ADMIN: organization/branch setup, manager provisioning, analytics.
- BRANCH_ADMIN: assigned-branch-only administration.
- TEACHER: assigned class attendance, homework, LMS, examinations.
- STUDENT: own attendance/homework/LMS/exam/result resources.
- PARENT: linked active children only.
- ACCOUNTANT: assigned finance branches, imports/exports.
- EMPLOYEE: own HR profile, leave, payslip and documents.

Also verify:
- login, refresh, idle/resume session behavior;
- branch-code reuse across two staging organizations;
- student/HR/finance imports;
- leave → attendance/substitution flow;
- homework submission/evaluation;
- LMS progress monotonicity;
- examination paper timing and result publication;
- announcement/circular/message isolation;
- transport/library/hostel/inventory representative workflows;
- backup creation and an isolated restore rehearsal.

## Promotion rule

Do not create a tag beginning with `v` until RC staging validation is accepted. Production deployment remains a separate explicit approval.
