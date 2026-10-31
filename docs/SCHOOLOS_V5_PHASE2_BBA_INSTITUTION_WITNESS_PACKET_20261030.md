# SchoolOS V5 — BBA institution Phase 2 witness and acceptance record (30 October 2026)

**Prepared from owner-supplied sanitized staging terminal output. NOT SIGNED. NOT independently witnessed. NOT a commercial GO.**

## Execution identity, scope and disclosures

- Institution: **Being Brilliant Academy (BBA)**, internal/owner-operated related-party pilot; authorized signatory: **Ajay Chaudhary**.
- Actual authenticated tenant: `org_default` / `being-brilliant-academy`, running V5 staging API/Web reported at revision `b54dca5ae36a948f83012faa4a37354198fba083`.
- Three **synthetic** tenant-local test branches, **not actual canonical campus master data**: `BBA-UAT-NDG`, `BBA-UAT-RNE`, `BBA-UAT-SHN`.
- Academic session `2026-27`, coaching batch mode. 3 artificial zero-fee courses, 3 batches (NDG supports mixed grades 5/6/7), 5 synthetic students, one multi-branch synthetic teacher.
- Evidence quality: tests were operator-run and outputs pasted into the ChatGPT conversation; broad consent to conduct internal UAT has been stated. **Original protected terminal artifact locator/checksum, dated human witness decision, related-party waiver and signatory acceptance have NOT been furnished.**
- No payments, production/V4 application changes, or real student personal data are claimed. No Phase 1 infrastructure, credential, backup, legal/finance or security task is closed here.

## BBA-01–12 scenario disposition for human review

| Ref | What was actually observed in BBA staging | Technical evidence status | Still requiring human witness, additional test or independent scope decision |
|---|---|---|---|
| BBA-01 | Tenant SUPER_ADMIN authenticated; three synthetic branches created via manager-deferred flow; mixed-grade batches and five synthetic admissions; invalid grade/duplicate ID/cross-branch tuple rejected. | **PARTIAL PASS** | Map **real** campus master branch data and contracted admissions/guardian scope; sign BBA witness. |
| BBA-02 | Single synthetic teacher, confirmed subject and valid allocations across 3 BBA branches; mixed grades 5/6/7 retained; allocation overlap rejection. | **TECHNICAL PASS** | Human course/teaching-role observation and original signed acceptance. |
| BBA-03 | Five synthetic attendance records (PRESENT/ABSENT/LATE), monthly report; a published NDG homework, student submission, evaluated 8/10, marks/duplicate/branch access restrictions. | **TECHNICAL PASS** | Authorized human witness, acceptance of role-specific roster and data visibility. |
| BBA-04 | Three branch timetables saved/read back; teacher double-booking HTTP 409; subject allocation effective-date misconfigured in UAT corrected; preview/save parity defect identified and addressed only on isolated **draft PR #290**. | **PARTIAL PASS / DEFECT OPEN** | Approve PR #290 only after CI review and coordinated deployment window; verify preview/save parity on an approved later staging revision; sign exception/decision. |
| BBA-05 | Three synthetic exams; invalid marks and cross-branch misuse rejected; five published synthetic results and five report-card PDFs. | **PARTIAL PASS** | Student/guardian-facing report access still not observed; human academic reviewer signoff. |
| BBA-06 | Three PUBLISHED Native LMS LiveClasses; teacher/student roles, join/leave attendance and cross-branch restrictions PASS; BBA room-scoped WebSocket signaling PASS. Synthetic teacher-to-student two-peer SFU media PASS in same browser: student video 14,105 RTP bytes / 121 packets / 119 decoded frames; audio 109,398 RTP bytes / 442 packets. | **PARTIAL PASS** | No independent physical-device reception, revoked-user case or attributable human witness. Sign observed media scope. |
| BBA-07 | **31 Oct owner-executed BBA native-class synthetic recording PASS:** Egress start/stop, R2 MP4 student LMS stream and browser HTML5 decode at 1280×720, 741,108 bytes; non-human generated media; cleanup PASS. | **TECHNICAL PASS — SYNTHETIC** | Original signed human recording/contract scope decision and cross-tenant download denial not witnessed. |
| BBA-08 | BBA AI Examiner feature accessible, three existing synthetic exams/readiness GETs readable, but `AI_PROVIDER_CONFIGURED=NO` and `AI_EVALUATION_EXECUTION_AVAILABLE=NO`. | **BLOCKED / NO AI GRADING PASS** | Provider setup exclusively through authorized Phase 1/cross-team configuration process; then provider execution, traceability, human review and failure/reconciliation test. |
| BBA-09 | SUPER_ADMIN, teacher and two student accounts verified; teacher impersonation and student ID spoof rejected; cross-branch learning scope denied. No BRANCH_ADMIN users were created (deferred manager provisioning); parent/accountant role UAT not observed. | **PARTIAL PASS** | Controlled BBA BRANCH_ADMIN provisioning/login and across-branch segregation, plus selected parent/accountant applicability. |
| BBA-10 | No institution training/handover participant or dated acceptance evidence in this run. | **PENDING** | Name actual attendees, documentation, applicable conversion/migration scope and support handoff. |
| BBA-11 | Phase 1 security/DR/ops artifacts exist outside this Phase 2 acceptance scope; not revalidated here. | **DEPENDENCY — PHASE 1** | Link original scoped signed Phase 1 security/DR/privacy acceptance, capture BBA own pilot risk boundary. |
| BBA-12 | Finance and Razorpay provider reconciliation outside this Phase 2 acceptance scope; synthetic zero-fee academic fixtures do not evidence finance. | **DEPENDENCY — FINANCE/PHASE 1** | Specify pilot non-billable intent and actual finance/legal TEST reconciliation/signoff where contracted. |

**Interpretation:** A row marked TECHNICAL PASS is an operator-observed successful synthetic test, **not** formal gate closure. A partial row must not be labeled full PASS. All current signed release gates remain **0/10 VERIFIED**, commercial GO **HOLD**.

### Subsequent BBA-07 provider evidence — 31 October 2026

An owner-operated synthetic BBA native classroom recording generated an MP4 through LiveKit Egress (start/stop PASS), an authenticated BBA student streamed it from R2 via LMS, and the browser successfully decoded video at **1280×720**; artifact measured **741,108 bytes**. Synthetic cleanup PASS. No actual student video or microphone was used. This supports BBA-07 technical synthetic acceptance but **not independently captured test-source proof, a cross-tenant MP4 denial, contracted scope approval, a signed human witness, or Gate 7 formal verification**. No Phase 1 security/credentials or production changes. Current Phase 1 incident #293 remains a distinct unresolved blocker.

## Audit trail / existing references

- Authoritative release board: GitHub Issue **#258**. Status and operator-evidence comments added on 30 October; avoid duplicating already passed runs.
- Separate Phase 2 implementation branch: `feature/v5-phase2-bba-acceptance-20261030`; Draft **PR #290**, containing timetable weekly preview/save allocation guard, contract test and this acceptance evidence packet. **Unmerged, undeployed.**
- Provenance source: owner-pasted sanitized VPS terminal outputs for BBA tenant revision `b54dca5...`; actual original saved log/path/hash to be supplied into an approved protected evidence vault, not invented here.
- Provisioned fixtures: scripts `schoolos_v5_bba_branch_uat.py`, `schoolos_v5_bba_academic_uat_20261030.py`, `schoolos_v5_bba_teacher_allocation_uat_20261030.py`, `schoolos_v5_bba_timetable_attendance_uat_20261030.py`, `schoolos_v5_bba_examination_uat_20261030.py`, corrected `schoolos_v5_bba_homework_lms_uat_20261030_v2.py`, `schoolos_v5_bba_native_live_class_uat_20261030.py`, and `schoolos_v5_bba_livekit_signaling_uat_20261030.py`.
- LiveKit signaling: `LIVEKIT_SIGNALING_WS=PASS_FRAME_RECEIVED`, **not** media/recording PASS.
- AI provider: disabled/not configured for actual BBA staging. No AI marks generated by provider. Teacher-to-student SFU media with synthetic canvas/oscillator succeeded in one Windows browser with separately authenticated peers; full provider Egress/R2 recording and student LMS replay remain unverified.

## Institutional witness / owner decision record — intentionally unsigned

| Required field | Current |
|---|---|
| Signatory / reviewer | Ajay Chaudhary — institution-approved authority, proposed signatory |
| Signature and signed UTC time | **NOT RECORDED** |
| Actual protected original artifact locator and hash | **NOT RECORDED** |
| Related-party conflict/independence waiver | **NOT SIGNED / NOT RECORDED** |
| BBA-01–12 accepted/rejected/exceptions | **REVIEW REQUIRED** — technical observations above, no final decision |
| Specific pilot module limitations | **NEEDS HUMAN DECISION** — AI provider disabled; media/recording pending; branch-admin pending; synthetic branch master data |
| Date-bounded revalidation of BBA branch data | **NEEDS HUMAN DECISION** |
| Commercial GO / formal Gate 7 | **HOLD / PENDING** |

When the accountable human reviews the evidence, preserve the original dated, attributable decision in a restricted evidence vault and reference it from Issue #258 with only the allowed non-sensitive locator/hash. **Do not use a checklist, this packet, or ChatGPT-authored text as a substitute for an actual witness signature.**
