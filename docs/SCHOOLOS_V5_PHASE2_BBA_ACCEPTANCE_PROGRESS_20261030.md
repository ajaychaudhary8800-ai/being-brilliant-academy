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
| Teacher homework and student LMS workflow | 0.40 | Corrected V2 operator run PASS: existing published NDG homework, teacher/2 student logins, own-student submission and readback, evaluation 8/10, cross-branch 422, impersonation 403, spoof 422, duplicate evaluate/re-submit 409 | 0.40 | 0 |
| Branch-admin authorization and branch isolation | 0.40 | Deferred manager provisioning left no BRANCH_ADMIN; UAT not executed | 0 | 0.40 |
| BBA LiveKit classroom and recording playback | 0.50 | BBA-specific entitlement/discovery PASS (30 Oct); 3 branch options, zero staff Meetings (not proof of absent LMS classes); native LMS classroom and provider media/recording acceptance not executed. Operator test script prepared. | 0 | 0.50 |
| BBA AI Examiner workflow and evidence | 0.45 | BBA entitlement and 3 existing synthetic exam/readiness GETs PASS; **AI_PROVIDER_CONFIGURED=NO / AI_EVALUATION_EXECUTION_AVAILABLE=NO**. No live evaluation; source/readiness only. | 0 | 0.45 |
| Dated human institutional review, exception list, related-party waiver and signoff | 0.45 | Owner approval intent reported; original reviewed/signed evidence not recorded | 0 | 0.45 |
| **Phase 2 total** | **5.00** | **Operator-observed technical coverage only** | **3.20** | **1.80** |

**Provisional Phase 2 completion: 64%; Phase 2 remaining: 36%.** Overall planning backlog after **only** the Phase 2 credits above: `20.00 - 3.20 = 16.80` percentage points. This number **has not been reconciled with parallel Phase 1 work** and must not be presented as the live whole-project completion number. Formal gates: **0/10 VERIFIED**.

## Observed functional details and follow-ups

### Passed, reuse without retesting

1. Branch creation on real BBA tenant with deferred manager provisioning; synthetic addresses/emails.
2. Five synthetic students; grade eligibility, unique admission number, and authorized branch/batch tuple.
3. Teacher eligibility across three coaching branches with confirmed subject links and active allocations; overlapping allocations rejected HTTP 409.
4. Three timetable schedules; teacher cross-branch time conflict rejected HTTP 409; attendance five records and readback, cross-branch rejection and monthly report.
5. Three exams, invalid marks and branch/exam conflicts rejected; five synthetic report-card PDFs.
6. Teacher/student homework LMS (corrected V2 script): owner-executed BBA test with NDG published homework, synthetic NDG student submit and teacher readback/evaluation 8/10 PASS, student ID spoof blocked HTTP 422, cross-branch RNE submission rejected HTTP 422 due academic-history context mismatch, max marks exceeded HTTP 422, duplicate evaluation HTTP 409 and post-evaluation resubmission HTTP 409. Result `BBA_HOMEWORK_LMS_UAT=OBSERVED_REQUIRES_HUMAN_REVIEW`. The initial script's invalid local due date format and wrong expected cross-branch HTTP status were corrected in UAT input/expectation only, no application or infrastructure change.

**Known functional defect:** On 30 October, the `POST /admin/timetables/weekly/preview` preflight originally omitted the effective allocation check used by `POST /admin/timetables`. An upcoming allocation start date caused the single save to fail with HTTP 422 `TEACHER_SUBJECT_NOT_ALLOCATED` while preview showed no conflict. The operator changed **only synthetic** allocation effective dates to 2026-10-30 and confirmed the BBA single-slot save and all three timetable+attendance scenarios PASS. This *did not* fix the preview/save parity in code. Draft PR #290 on the isolated Phase 2 branch adds the existing effective-allocation guard to shared weekly preview/save and a static contract regression. Exact-head GitHub CI was observed SUCCESS at commit `dd44785f34470e6dc6f4072d292d68491738a7de`; V4 rehearsal/sandbox/external QA were SKIPPED for the PR branch and must not be described as PASS. Coordinated staging proof still required; **do not deploy during Phase 1**.

### BBA read-only LiveKit and AI preflight (operator observed 30 October 2026)

Validated deployed V5 API/Web image revision `b54dca5...` and real BBA admin `org_default`. Three synthetic BBA branches visible; `meetings/options` included all three, participants readable, `GET /meetings` returned zero records. **Meetings are staff-only**; zero Meetings does not establish absence of LMS native LiveClass records. `GET /ai-examiner/capabilities` available, provider **NOT configured** and evaluation execution **NOT available**. Three prior published synthetic BBA exams appear in AI Examiner read-only list and all three readiness GET endpoints returned objects. No video, provider egress, AI grading, production or deployment action occurred. This is discovery evidence, not LiveKit/AI final acceptance.

The subsequent native classroom UAT is a **separate operator-executed synthetic script** `schoolos_v5_bba_native_live_class_uat_20261030.py` to create/reuse three native LMS LiveClasses, exercise teacher/student token issuance and join/leave without media, verify cross-branch student isolation and teacher role protection. Its output is **pending**; no credit is allocated for a prepared script. Full LiveKit media connectivity/recording playback and human witness are still needed.

**AI dependency:** Because the actual BBA staging capability reports `AI_PROVIDER_CONFIGURED=NO`, do not run evaluations or claim AI Examiner functional PASS. Provider enablement would need a separately coordinated, secured configuration review in Issue #258 after Phase 1 safety ownership; no credential changes by Phase 2.

### Outstanding scenarios and acceptance criteria

- **Homework/LMS:** **COMPLETED technical UAT**, using existing BBA synthetic teacher and students. Full successful corrected V2 run recorded by owner, with the results above. Final human acceptance and signed institutional record still pending. Do not rerun these passing tests.
- **Branch Admin:** No user accounts were created by deferred manager mode. Test must use supported account setup/provisioning and a verifiably controlled test inbox; do **not** reclassify real students/teachers, insert SQL identities, forge credentials, or assume another user's login.
- **LiveKit:** Use BBA staging synthetic teacher/student role logins; verify permissions, joining/rejoining, video controls, a limited recording where subscribed, readback/playback/audit, error handling and termination. Review exact BBA entitlement first. Keep paid-video flags OFF; never capture real children, publish real media, or rerun historical provider infrastructure tests without a reason.
- **AI Examiner:** Use a synthetic BBA-tenant exam; verify feature entitlement, answer-sheet input and grading/review traceability, role segregation and student-facing result release. Distinguish AI assistive outputs from human-validated marks. Keep identifiable children and real high-stakes grading out of UAT.
- **Human signoff:** Authorized BBA sponsor to review all observed runs, add exact date and source/tenant, defect disposition, related-party conflict waiver and protected original evidence locator/hash. Do not invent signatures; Gate 7 cannot be formally closed by an automated script.

## Phase 2 stop and go conditions

- No V4 production changes, shared staging deployment or Phase 1 security/infrastructure operations.
- Do not close a formal gate without its independent/or human-accountable source evidence and applicable documented signoff.
- A code PR may be reviewed/CI-tested on an isolated feature branch but **must not be merged/deployed** while concurrent Phase 1 is modifying infrastructure.
- Do not re-execute passing academic, admissions, timetable, attendance or examination tests simply to inflate coverage.
