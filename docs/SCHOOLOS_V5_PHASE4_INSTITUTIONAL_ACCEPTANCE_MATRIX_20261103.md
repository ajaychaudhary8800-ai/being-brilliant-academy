# SchoolOS V5 — Phase 4 institutional acceptance reconciliation

**Prepared 3 November 2026 · evidence-index / review copy · NO institutional signoff.** Release board: [#258](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/258). BBA signatory: Ajay Chaudhary (appointed, not signed). Related-party institution: Being Brilliant Academy (BBA), not an independent customer. No production or shared-staging changes authorized.

## Source precedence and evidence classes
Reuse [BBA-01–12 handoff](SCHOOLOS_V5_BBA_INTERNAL_PILOT_UAT_HANDOFF_20261029.md), [U01–U15 customer matrix](SCHOOLOS_V5_CUSTOMER_UAT_AND_PILOT_REVIEW.md), [coaching staging QA](SCHOOLOS_V5_COACHING_STAGING_UAT.md), [implementation kit](CLIENT_IMPLEMENTATION_KIT.md), [Phase 2 draft #290](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/pull/290) and issue #258 before any re-execution. `REUSED_SYNTHETIC` means previously reported engineering evidence, **not** human-observed BBA acceptance. `OPERATOR_REPORTED` requires source-artifact attribution. `PENDING_WITNESS`, `BLOCKED_BY_PHASE_1`, `BLOCKED_BY_PHASE_2`, `BLOCKED_BY_PHASE_3` are not PASS. Exact V5 candidate image digest and real BBA tenant have not been established here.

| Reference | Mode / workflow | Prior technical evidence to reuse | Gap / status | Owner |
|---|---|---|---|---|
| BBA-01 / U01 | Coaching admissions, guardian, duplicate/mobile policy, branch ownership | Prior cross-tenant coaching admission regression | Real BBA tenant and data-scope mapping; **PENDING_WITNESS / PHASE_2** | BBA sponsor |
| BBA-02 / U02-U03 | Mixed-grade batches 5/6/7; teacher across authorized branches; preserve student grade | QA placement, allocation and branch isolation previously PASS in synthetic tenants | Reconcile genuine NDG/RNE/SHN learners/teachers; **PENDING_WITNESS / PHASE_2** | Academic owner |
| BBA-03 / U05 | Class/teacher attendance, homework assignment, student submission, grading, impersonation denial | 3-branch synthetic workflow; duplicate submission rejection and 403 denial previously reported | BBA role observation / **PENDING_WITNESS / PHASE_2** | Teacher + student |
| BBA-04 / U07 | Timetable preview/save allocation parity; collision denial | Successful corrected-fixture QA; #290 proposes code guard | #290 unmerged/undeployed; verify target exact SHA before institutional witness; **BLOCKED_BY_PHASE_2** | Academic admin |
| BBA-05 / U06 | Exams, marks, publish/unpublish, report card and guardian visibility | NDG/RNE/SHN synthetic exam + portal readback reported | Real BBA result visibility and approved grading policy / **PENDING_WITNESS** | Exam owner |
| BBA-06 / U09 | Native Live Classroom teacher/enrolled learner; deny foreign/unauthorized roles | Authenticated synthetic PostgreSQL and browser token checks reported | BBA teacher/student witness at authorized source; **BLOCKED_BY_PHASE_1 + PHASE_2** | LMS owner |
| BBA-07 / U10 | LiveKit recording → R2 MP4 → student LMS playback; cross-tenant denial | Owner-reported synthetic 1280×720 playable recording and R2 round-trip | BBA contracted scope, secure provider deployment, source witness; paid flags OFF; **BLOCKED_BY_PHASE_1 + PHASE_2** | LMS/ops |
| BBA-08 / U08 | AI Examiner marking/benchmark/failure/override and usage evidence | Module available; AI provider not configured in prior V5 preflight | Real approved-provider BBA QA and review rubric; **BLOCKED_BY_PHASE_2**, no provider PASS claimed | Academic/AI |
| BBA-09 / U11-U12 | Platform super admin vs branch admin/teacher/student/parent/accountant; negative auth | Synthetic forbidden access, cross-branch and tenant isolation tests | Branch manager creation #290 remains draft; BBA role list/negative witness / **BLOCKED_BY_PHASE_1 + PHASE_2** | Security/UAT |
| BBA-10 | Handover, data import counts, training, open-defect acceptance | Existing implementation kit and admin/teacher/student manuals | Actual tenant records, named trainees, import acceptance / **PENDING_WITNESS** | Institution |
| BBA-11 / U15 | Privacy/backup, support, alerting, rollback, DR applicability | Isolated DB/files restore and offsite manifest parity operator-reported | #281/#292/#293, RPO/RTO, Vault/media, alert routing / **BLOCKED_BY_PHASE_1** | Operations |
| BBA-12 / U13-U14 | Only if specifically in scope: quotes, TEST payment/refund/dispute, reconciliation | Synthetic signed-webhook, idempotency/finance holds; Phase 3 draft #294 | Actual authorized TEST-to-ledger and finance witness; **BLOCKED_BY_PHASE_3** | Finance |

## Separate school-mode acceptance matrix
School-mode must retain **SECTION** terminology and class/section boundaries, rather than reusing coaching BATCH exceptions. No complete institution-witnessed school-mode acceptance is supplied.

| S-ref | Acceptance scenario | Required observation | State |
|---|---|---|---|
| S01 | School admissions + class/section, parent linkage | Correct school term, current grade, assigned section and same-tenant guardian access | PENDING_WITNESS |
| S02 | Mixed-grade coaching batch attempt | School mode rejects unsupported mixed class placement, with no mutation | REUSED_SYNTHETIC; PENDING_WITNESS |
| S03 | Unauthorized cross-branch subject/teacher allocation | School restrictions/permissions denied and audit evidence retained | REUSED_SYNTHETIC; PENDING_WITNESS |
| S04 | Class teacher attendance, periods, timetable overlaps | Scoped section roster; timetable preview/save parity, collisions rejected | BLOCKED_BY_PHASE_2 |
| S05 | Exams, grade/report card, student/parent result visibility | Only correct academic year, grade, section and release state displayed | PENDING_WITNESS |
| S06 | Fees, invoice/receipt, ledger and refund boundaries | Correct tenant, enrollment and commercial policy; no real money in staging | BLOCKED_BY_PHASE_3 if provider path applicable |
| S07 | School admin / teacher / student / parent least privilege | Admin controls restricted; other school/campus denied | BLOCKED_BY_PHASE_1 + PHASE_2 |

## Separate coaching-mode acceptance matrix
| C-ref | Acceptance scenario | Required observation | State |
|---|---|---|---|
| C01 | NDG / RNE / SHN permitted branches and grade-specific programs | Tenant branch linkage and academic session validated | REUSED_SYNTHETIC; PENDING_WITNESS |
| C02 | MIX NDG cross-grade batch | Each student's grade retained through homework, exam and reporting | REUSED_SYNTHETIC; PENDING_WITNESS |
| C03 | Teacher teaches across permitted branches | Allocation and timetable positive paths pass, unauthorized branches denied | REUSED_SYNTHETIC; PENDING_WITNESS |
| C04 | Branch Admin on an existing deferred branch | Only verified authorized recipient, no elevation or replacement, setup link delivered | BLOCKED_BY_PHASE_2 (#290 draft) |
| C05 | Parent/student LMS + native classroom | Enrollment and visibility consistent, revoked roles denied | BLOCKED_BY_PHASE_1 + PHASE_2 |
| C06 | Coaching billing and subscription receipt | Signed QA contract, TEST reconciliation, no live collection | BLOCKED_BY_PHASE_3 |

## Role acceptance checklists (run on real approved UAT tenant)
- **Platform administrator:** enumerate active tenants, inspect exact tenant scope, no implicit institution-data access; only platform authority may change entitlements, plan and owner settings.
- **Institution/branch administrator:** create permitted student/teacher/section/batch, admit or reject duplicate, record fee workflow, publish approved exam; cannot operate another tenant or appoint own higher privilege. For branch administrators, verify direct `/admin/overview` metrics include only explicitly assigned branches and do **not** expose tenant-wide revenue; review stacked #315.
- **Teacher:** view only allocated classes/subjects; timetable, attendance, homework, assessment and classroom controls within assigned branch/batch; reject unrelated student or unallocated subject.
- **Student:** view own timetable, homework, grading, published results and permitted recording; cannot access another student's or tenant's content.
- **Parent/guardian:** view only verified linked children; correct fee/result state; no school-wide data or unauthorized uploads.
- **Finance/accountant (where contracted):** limited ledger/invoice access; no webhook secret or platform privilege; finance approval remains separate from API success.

## Multi-branch/permissions and defects register
For each role × branch × mode, test **same-tenant authorized**, **other branch unauthorized**, **other-tenant unauthorized**, **inactive/revoked**, **direct API not merely hidden UI**. Expected denial must have no cross-boundary side effects. A 403/404 is acceptable only where specified and an audit record is captured where implemented. Avoid publishing student identifiers.

| ID | Finding / exception | Severity | Disposition | Dependency |
|---|---|---|---|---|
| F4-01 | Real BBA tenant, branches and approved real-data scope not evidenced | Gate blocker | Open; bind protected tenant IDs and witness | Phase 2 |
| F4-02 | Branch Admin appointment and timetable preview/save parity only proposed in draft #290 | Gate blocker | Open; source approval/targeted deployment | Phase 2 / Phase 1 |
| F4-03 | AI Examiner exact-provider institutional marking not observed | Gate blocker if AI sold | Open or mark formally NOT APPLICABLE only by approved scope | Phase 2 |
| F4-04 | Historical PostgreSQL/Redis image-history exposure and rotation not accepted | Critical | Open #293 | Phase 1 |
| F4-05 | Signed retrievable compatible previous API/Web pair not evidenced | Critical | Open #292 | Phase 1 |
| F4-06 | Actual Razorpay provider TEST ↔ contract/invoice/ledger unavailable | Gate blocker if billing sold | Open #294 / Gate 4 | Phase 3 |
| F4-07 | Signed BBA witnessed UAT and related-party waiver absent | Gate blocker | Open; protected originals only | Human witness |
| F4-08 | Branch Administrator `/admin/overview` originally included tenant-wide branch/student/course/enrolment/invoice aggregates despite role being branch-scoped | Source-confirmed branch authorization gap; production impact NOT ATTESTED | Isolated stacked [draft #315](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/pull/315) restricts branch KPIs and withholds unallocatable invoice revenue; exact-head CI and institutional acceptance pending | Phase 2 + Phase 4 |
| F4-09 | `PATCH /admin/users/:id/role` and role policy acknowledged unchanged roles before branch/administrator authorization | Source-confirmed role-existence inference path (tenant-scoped); no actual exploitation demonstrated | Stacked [#315](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/pull/315) checks role/branch authorization before idempotent responses; isolated policy unit and real PostgreSQL HTTP tests added, exact-head CI pending | Phase 2 + Phase 4 |
| F4-10 | Branch Admin with no assigned branches could list globally shared courses; assigned Branch Admin could see unfiltered shared-course enrolment/batch totals for other campuses | Source-confirmed cross-branch aggregate scope, actual exposure NOT ATTESTED | New stacked [Draft #316](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/pull/316) denies unassigned catalog listing and scopes shared-course enrolment/batch counts; authenticated isolated PostgreSQL tests and exact-head CI pending | Phase 2 + Phase 4 |

## Institutional signatory handoff (uncompleted)
Record privately: legal institution identity; genuine tenant/branch IDs; exact deployed source, immutable image mapping and timestamps; accepted modules; scenario-by-scenario expected/observed and defect references; actual human witnesses; exclusions and rationale; migration/import reconciliation; privacy/processing scope; related-party disclosure and waiver; Ajay's dated ACCEPT / CONDITIONAL / REJECT decision and protected signature locator/hash. **All signatures, observed BBA PASS outcomes and waiver acceptance remain PENDING.**

**Phase 4 formal signoff: HOLD.** This document indexes reusable evidence and reduces duplicate QA; it does not run staging tests, validate BBA customer acceptance or change the V5 gate manifest.
