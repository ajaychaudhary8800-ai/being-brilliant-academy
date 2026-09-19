# Phase 6 — Release Readiness & Cross-Role QA

Phase 6 is the final V2 validation phase before a release candidate can be considered production-ready. It does not authorize production deployment.

## Release gates

All gates below must pass on the exact PR head that is merged into `v2-development`.

1. Existing database migration deploy succeeds.
2. Fresh dedicated PostgreSQL integration database can apply the full migration chain.
3. Full API regression and PostgreSQL integration suite passes with zero failures and zero skips.
4. Typecheck passes.
5. Production build passes.
6. Runtime readiness/health smoke test passes.
7. Docker Compose configuration validates.
8. API image builds.
9. Web image builds.
10. Branch is 0 commits behind `v2-development` at merge time.
11. Final diff contains no unrelated product work.
12. Critical cross-role workflow matrix below has automated or explicit verified coverage.

## Roles

- SUPER_ADMIN
- BRANCH_ADMIN
- TEACHER
- STUDENT
- PARENT
- ACCOUNTANT
- EMPLOYEE

## Critical workflow matrix

### Identity, tenancy and access
- Login/logout/session refresh and expiry behavior.
- Organization and branch isolation for every role.
- Branch-admin access limited to assigned branches.
- Teacher access limited to assigned academic context.
- Student access limited to own academic/portal resources.
- Parent access limited to linked active children.
- Accountant access limited to permitted finance branches.
- Employee self-service limited to own HR records/documents.

### Institution setup and academics
- Organization settings and institution-aware terminology.
- Branch creation and branch manager access.
- Course, subject, batch/class-section and academic-session setup.
- Teacher allocation and timetable generation.
- Student admission/enrollment/academic transition/history.
- Free period, substitution and duty assignment conflict handling.

### Attendance and leave
- Teacher attendance marking only for assigned batches.
- Historical student placement used for attendance/leave.
- Holiday skipping.
- Student/parent leave submission and approval.
- Teacher/employee leave and substitution interaction.
- Branch and tenant isolation for reads and writes.

### Homework and LMS
- Teacher creates, publishes, closes and archives homework.
- Student views, submits and replaces work only while allowed.
- Teacher evaluation is race-safe and immutable after finalization.
- Parent can view linked-child homework without cross-child leakage.
- LMS lesson draft/publish/archive lifecycle.
- Student progress is server-derived and monotonic.
- Archived/historical lesson context remains stable.

### Examinations and checking
- Examination creation/scheduling and branch/teacher authorization.
- Question paper is inaccessible before both publication time and exam start.
- Student answer-sheet upload/replacement rules.
- Teacher evaluation/finalization.
- Results cannot publish until required evaluation/result generation is complete.
- Published report cards/certificates obey lifecycle and ownership rules.

### Fees and finance
- Fee plan, assignment, adjustment, collection and payment offset workflows.
- Student and fee-head immutability after first payment where required.
- Accountant RBAC and branch scope.
- Journal/account-group/account import tenant isolation.
- XLSX/CSV/JSON account imports are atomic and duplicate-safe.
- Exports require authorization.

### Communications
- Announcement, circular, calendar, notification and message tenant integrity.
- Teacher/student/parent audience authorization.
- Attachments cannot cross tenant/branch/resource boundaries.
- Delivery/read/acknowledgement state remains tenant-safe.

### Enquiries, admissions and CRM
- Enquiry create/edit/follow-up lifecycle.
- CONVERTED is only reachable through the admission conversion workflow.
- Converted/archived enquiries cannot be mutated by ordinary edit/follow-up paths.
- Branch scope and duplicate detection are tenant-bound.
- Conversion produces valid student/admission state atomically.

### HR and payroll
- Employee CRUD, movements, documents and self-service access.
- Department/designation masters tenant isolation.
- Attendance, leave, salary structures, loans, reimbursements and overtime.
- Payroll run calculation/status/report/payslip access.
- XLSX/CSV/JSON employee import validates all rows before mutation and is atomic.
- HR exports are authenticated.

### Operational ERP
- Transport vehicle/staff/route/assignment/trip/fee/document flows.
- Library masters/books/copies/members/loans/fines/digital-resource downloads.
- Hostel room/bed/allocation/fees/attendance/gate-pass/visitor/asset flows.
- Inventory/procurement/stock/asset/maintenance flows.
- SUPER_ADMIN operational scope means all active branches in the authenticated organization, never all database tenants.

### Analytics and reports
- Executive KPIs are tenant-bound.
- Branch-admin analytics aggregate assigned branches only.
- Student/teacher drilldowns respect caller scope.
- Analytics cache keys include organization identity.
- Saved reports, schedules, alerts and assistant queries carry organization ownership.
- Analytics assistant is restricted to executive roles.

## Release-blocking defect classes

Any confirmed case below blocks Phase 6 completion:

- Cross-tenant or unauthorized cross-branch data access.
- Privilege escalation or role bypass.
- Partial/nonatomic financial, payroll, admission or bulk-import mutation.
- Historical academic context being rewritten after submissions/progress/payments.
- Published/finalized records becoming mutable without an explicit audited workflow.
- A migration that fails on either the existing upgrade path or a fresh database.
- Failing or skipped PostgreSQL integration tests.
- Typecheck/build/runtime/container failure.
- Broken authentication on protected downloads/imports/exports.
- A critical workflow that cannot be completed by its intended role.

## Merge rule

PR remains draft until all Phase 6 release gates are green. Production deployment is a separate explicit action after release-candidate approval.
