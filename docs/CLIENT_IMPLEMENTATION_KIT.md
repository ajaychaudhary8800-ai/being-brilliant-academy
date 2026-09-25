# Client Go-Live & Implementation Kit

This document is the platform-operator runbook for taking a real school, coaching centre, academy, training institute, or other education organization from signed commercial agreement to production handover.

## 1. Client information and requirements

Collect and verify before tenant provisioning:

- Organization display name and legal name.
- Primary email and phone.
- Primary administrator name and email.
- Institution type.
- Desired shared workspace slug.
- Preferred academic group terminology: Section, Batch, Group, or custom label; collect the custom label when applicable.
- Timezone, locale, currency, academic-year start month.
- SaaS plan, billing cycle, subscription status, applicable trial/subscription end dates, and agreed limits.
- Logo, primary colour, secondary colour.
- Whether a custom domain is required and the requested hostname.
- Target go-live date.
- Whether migration is required, source system, and migration scope.
- Client training contact details and intended training users.
- Named approval/sign-off authority and contact details.

Use `/client-kit/client-information.csv` as the primary collection sheet.

Use `/client-kit/branches-data-collection.csv` for every branch/campus that must be created. It mirrors the current branch-creation contract: branch code/name, full address, city/state/pincode, phone/email, manager name/email, opening date, and active status.

Never ask platform staff to set or retain the tenant administrator's password. Use the secure account-setup flow.

## 2. Data migration templates

### Direct-import compatible

These files match current application import contracts:

- `/client-kit/students-import.csv`
- `/client-kit/employees-import.csv`
- `/client-kit/finance-accounts-import.csv`

Student import supports CSV, XLSX, and JSON through Student Management. Employee and finance-account imports support XLSX, CSV, and JSON through their respective modules.

Important direct-import rules:

- IDs such as `branchId`, `batchId`, `departmentId`, `designationId`, and `groupId` must belong to the target tenant.
- Dates should use ISO `YYYY-MM-DD`.
- Student gender values: `MALE`, `FEMALE`, `OTHER`.
- Student status values: `ACTIVE`, `INACTIVE`, `ARCHIVED`.
- Employee status values: `ACTIVE`, `INACTIVE`, `NOTICE`, `EXITED`, `ARCHIVED`.
- Finance account type values: `ASSET`, `LIABILITY`, `INCOME`, `EXPENSE`, `EQUITY`.
- Financial opening balances are in paise. Do not populate both debit and credit opening balances for one account.
- Never reuse IDs copied from another organization.

### Collection/mapping templates

These files are for client data collection and implementation mapping. They are not currently one-click bulk imports:

- `/client-kit/branches-data-collection.csv`
- `/client-kit/teachers-data-collection.csv`
- `/client-kit/courses-data-collection.csv`
- `/client-kit/fees-data-collection.csv`

Platform staff must map and validate these records against tenant masters before entry/import. Do not tell clients these are direct-import files.

## 3. Implementation sequence

Before provisioning, complete the controlled sales/legal documents in `docs/legal-sales/`: signed Order Form, SaaS Agreement, applicable DPA/SLA, and Implementation SOW.

1. Confirm commercial plan and scope against the signed Order Form and SOW.
2. Collect the client-information sheet and branch/campus sheet.
3. Validate commercial status, dates, migration scope, training contacts, and sign-off authority.
4. Provision tenant from Platform Admin -> Organizations.
5. Confirm tenant administrator activates the account.
6. Create branch/campus and branch administrator where required.
7. Configure academic session, courses/programs, batches/sections, subjects, classrooms, and staff masters.
8. Map client data against tenant IDs/masters.
9. Run data imports in staging or controlled production batches.
10. Reconcile import counts and errors.
11. Configure fees/finance as contracted.
12. Configure LMS, examinations, communication, HR/payroll, and other entitled modules.
13. Complete administrator/user training.
14. Complete UAT.
15. Configure custom domain when included in the plan.
16. Confirm backup/monitoring state.
17. Obtain authorized go-live sign-off.
18. Mark the organization onboarding panel READY / 100%.
19. Perform production smoke test after handover.

## 4. UAT checklist

The client should test the modules included in its plan. Record PASS, FAIL, or NOT APPLICABLE for each applicable item:

- Login and password setup.
- Branch/campus access.
- User and role access.
- Student admission/import and records.
- Teacher/staff records.
- Courses/programs, batches/sections, subjects.
- Timetable and attendance.
- Homework assignment, submission, feedback.
- Examination creation, paper handling, answer submission, evaluation/results.
- Fees, receipts, defaulters, adjustments.
- Finance/accounting where licensed.
- LMS lessons/materials and learner access.
- Parent portal and student portal.
- Teacher portal.
- Communication/notices/announcements.
- HR/payroll where licensed.
- Reports/analytics where licensed.
- Organization branding.
- Custom domain when licensed.
- Subscription/entitlement restrictions.

Any failed critical workflow must be resolved or explicitly accepted as a documented deferred item before go-live approval.

## 5. Go-live acceptance and sign-off

Record the following in the implementation record:

- Organization name.
- Production workspace slug/domain.
- Plan.
- Go-live date.
- Data migration status.
- Training completion date.
- UAT completed by.
- Outstanding accepted items.
- Client approval name/designation/date.
- Platform approval name/designation/date.

Do not mark **Go-live approved** in the onboarding panel until the authorized client representative has accepted the production setup.

## 6. Custom domain handover

For a custom domain:

1. Confirm the assigned plan includes `custom_domain`.
2. Client provides the desired hostname, for example `erp.schoolname.com`.
3. Client either grants controlled DNS access or adds the DNS records supplied by platform operations.
4. Configure the hostname in the tenant white-label settings.
5. Configure the hostname in Coolify/proxy.
6. Confirm DNS resolution.
7. Confirm TLS certificate issuance.
8. Test login, API calls, password-reset links, and tenant isolation on the custom hostname.
9. Keep the shared workspace login available as a fallback.

Do not invent a universal A/CNAME target in client documentation; the exact DNS target must come from the active production infrastructure.

## 7. Support and escalation

Classify operational issues as:

- **P1 Critical:** production unavailable, cross-tenant exposure, severe security incident, or widespread inability to perform core workflows.
- **P2 High:** major entitled module unavailable for a client with no reasonable workaround.
- **P3 Normal:** isolated defect, configuration issue, data correction request, usability issue, or how-to support.

The contractual response/resolution times must come from the client's commercial agreement. Do not promise SLA times that are not in the signed agreement.

Capture for every support case:

- client organization;
- reporter and contact;
- date/time and timezone;
- affected module;
- user role;
- reproduction steps;
- screenshots/error text;
- business impact;
- environment;
- workaround, if any;
- owner and status.

## 8. Security and responsibility boundaries

Platform operations are responsible for platform availability controls, tenant isolation, application security controls, backups configured in the deployment, deployment change control, and incident handling within the agreed service scope.

The client is responsible for accurate source data, authorized user lists, keeping user credentials private, promptly disabling departed users, domain/DNS changes under its control, and lawful use of uploaded content and personal data.

Do not promise off-site disaster recovery until off-site object storage is configured and a restore drill has been verified.

## 9. Backup and recovery acceptance

Before a paid-client production launch, verify:

- automated backup schedule is running;
- a recent backup exists;
- database and file checksums pass;
- retention is configured;
- available disk capacity is adequate;
- off-site backup is enabled if promised contractually;
- an isolated restore drill has been completed when the service commitment requires disaster recovery.

## 10. Final handover criteria

A client is operationally ready only when:

- onboarding readiness reports 100% / READY;
- applicable UAT checks pass;
- commercial plan and entitlements are aligned;
- client administrator access is confirmed;
- required data is migrated/reconciled;
- training is complete or explicitly not required;
- production URL is verified;
- go-live approval is recorded;
- production smoke testing is complete.

The Platform Admin **Implementation Kit** page exposes the downloadable templates and operational checklist for staff use.
