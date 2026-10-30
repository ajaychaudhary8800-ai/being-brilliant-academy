# SchoolOS V5 — Phase 2 BBA ERP/LMS & AI Acceptance (30 October 2026)

**Owner-defined scope:** BBA three-branch UAT; academic, admissions, teacher allocation, timetable, attendance, examinations, teacher/student LMS, branch-admin authorization, LiveKit and AI Examiner. **Excluded:** Phase 1 security, secrets, Docker/Coolify/volumes, deployment and production changes.

**Source of status:** sanitized outputs supplied by the BBA authorized operator following authenticated, synthetic-data V5 staging tests. These are observed functional results, **not formal signed institutional acceptance or an independent audit**.

## Coordination and environment

- Issue #258 is the authoritative release board. Formal production release remains **HOLD**, **0/10 formally verified release gates**.
- Last operator-observed V5 staging API/Web revision: `b54dca5ae36a948f83012faa4a37354198fba083`.
- Genuine BBA tenant: `org_default`, slug `being-brilliant-academy`, coaching mode `BATCH`.
- UAT uses three **synthetic** BBA-tenant branches: `BBA-UAT-NDG`, `BBA-UAT-RNE`, `BBA-UAT-SHN`. These are *not* verified actual operational branch master records; zero manager accounts were created.
- Phase 2 development branch: `feature/v5-phase2-bba-acceptance-20261030`; **no merge, V5 staging deployment, Phase 1 infrastructure write, paid collection, paid-video activation or V4 production change** without separate coordinated approval.
- Any later V5 staging deployment must be coordinated via Issue #258 after Phase 1 infrastructure operations are clear.

## Evidence-indexed task allocation (provisional 5.00 percentage points of the original 20-point planning backlog)

| Task | Budget (pp) | Evidence observed | Credited (pp) | Remaining (pp) |
|---|---:|---|---:|---:|
| BBA tenant and 3 synthetic branch setup | 0.35 | BBA auth; three branches created/read back; zero BRANCH_ADMIN accounts | 0.35 | 0 |
| Academic/session, courses, batches, 5 synthetic admissions | 0.60 | Session 2026-27; 3 courses, mixed grades 5/6/7 and 3 batches, 5 enrollments; duplicates / invalid grade / branch mismatch rejected | 0.60 | 0 |
| Teacher and cross-branch allocations | 0.55 | Synthetic teacher, mapped active subject/course, 3 branches eligible/allocated; overlap 409 and admin access restriction | 0.55 | 0 |
| Timetable + attendance | 0.65 | Three class schedules; double-booking 409; five attendance records, duplicate 409, cross-branch 422, monthly report | 0.65 | 0 |
| Examinations and report cards | 0.65 | Three exams, statuses, negative validations; five generated/published synthetic results and report-card PDFs | 0.65 | 0 |
| Teacher homework and student LMS workflow | 0.40 | Script available; not yet operator executed | 0 | 0.40 |
| Branch-admin authorization and branch isolation | 0.40 | Deferred manager provisioning left no BRANCH_ADMIN; UAT not executed | 0 | 0.40 |
| BBA LiveKit classroom and recording playback | 0.50 | Prior isolated provider egress/R2 checks reusable; no witnessed BBA-tenant classroom/role test yet | 0 | 0.50 |
| BBA AI Examiner workflow and evidence | 0.45 | Prior synthetic/contract work reusable; no witnessed BBA-tenant examiner trace yet | 0 | 0.45 |
| Dated human institutional review, exception list, related-party waiver and signoff | 0.45 | Owner approval intent reported; original reviewed/signed evidence not recorded | 0 | 0.45 |
| **Phase 2 total** | **5.00** | **Operator-observed technical coverage only** | **2.80** | **2.20** |

**Provisional Phase 2 completion: 56%; Phase 2 remaining: 44%.** Overall planning backlog after **only** the Phase 2 credits above: `20.00 - 2.80 = 17.20` percentage points. This number **has not been reconciled with parallel Phase 1 work** and must not be presented as the live whole-project completion number. Formal gates: **0/10 VERIFIED**.

## Observed functional details and follow-ups

### Passed, reuse without retesting

1. Branch creation on real BBA tenant with deferred manager provisioning; synthetic addresses/emails.
2. Five synthetic students; grade eligibility, unique admission number, and authorized branch/batch tuple.
3. Teacher eligibility across three coaching branches with confirmed subject links and active allocations; overlapping allocations rejected HTTP 409.
4. Three timetable schedules; teacher cross-branch time conflict rejected HTTP 409; attendance five records and readback, cross-branch rejection and monthly report.
5. Three exams, invalid marks and branch/exam conflicts rejected; five synthetic report-card PDFs.

**Known functional defect:** On 30 October, the `POST /admin/timetables/weekly/preview` preflight originally omitted the effective allocation check used by `POST /admin/timetables`. An upcoming allocation start date caused the single save to fail with HTTP 422 `TEACHER_SUBJECT_NOT_ALLOCATED` while preview showed no conflict. The operator changed **only synthetic** allocation effective dates to 2026-10-30 and confirmed the BBA single-slot save and all three timetable+attendance scenarios PASS. This *did not* fix the preview/save parity in code. Draft PR #290 on the isolated Phase 2 branch adds the existing effective-allocation guard to shared weekly preview/save and a static contract regression. CI and later coordinated staging proof required; **do not deploy during Phase 1**.

### Outstanding scenarios and acceptance criteria

- **Homework/LMS:** Existing `schoolos_v5_bba_homework_lms_uat_20261030.py` script is source-reviewed and Python-compiles locally. It explicitly rotates credentials **only for one synthetic teacher and two synthetic student users** and runs publish, submit, evaluate, cross-branch and role negative cases. Never print or share credentials. Running it requires an authenticated staging operator and a safe Phase 1 maintenance window.
- **Branch Admin:** No user accounts were created by deferred manager mode. Test must use supported account setup/provisioning and a verifiably controlled test inbox; do **not** reclassify real students/teachers, insert SQL identities, forge credentials, or assume another user's login.
- **LiveKit:** Use BBA staging synthetic teacher/student role logins; verify permissions, joining/rejoining, video controls, a limited recording where subscribed, readback/playback/audit, error handling and termination. Review exact BBA entitlement first. Keep paid-video flags OFF; never capture real children, publish real media, or rerun historical provider infrastructure tests without a reason.
- **AI Examiner:** Use a synthetic BBA-tenant exam; verify feature entitlement, answer-sheet input and grading/review traceability, role segregation and student-facing result release. Distinguish AI assistive outputs from human-validated marks. Keep identifiable children and real high-stakes grading out of UAT.
- **Human signoff:** Authorized BBA sponsor to review all observed runs, add exact date and source/tenant, defect disposition, related-party conflict waiver and protected original evidence locator/hash. Do not invent signatures; Gate 7 cannot be formally closed by an automated script.

## Phase 2 stop and go conditions

- No V4 production changes, shared staging deployment or Phase 1 security/infrastructure operations.
- Do not close a formal gate without its independent/or human-accountable source evidence and applicable documented signoff.
- A code PR may be reviewed/CI-tested on an isolated feature branch but **must not be merged/deployed** while concurrent Phase 1 is modifying infrastructure.
- Do not re-execute passing academic, admissions, timetable, attendance or examination tests simply to inflate coverage.
