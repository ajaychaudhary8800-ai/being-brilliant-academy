# SchoolOS V5 — Being Brilliant Academy institutional acceptance decision packet

**Prepared 31 October 2026 — UNSIGNED / NOT FINAL ACCEPTANCE.**
This packet is an evidence index and prospective human decision form. It must not be interpreted as a witnessed run, signature, signed-related-party waiver, security attestation, production GO, or certification of a provider not configured.

## Actual institution and immutable scope reference

- Institution: Being Brilliant Academy (BBA), owner-operated / related-party internal pilot; BBA's authorized human signatory: Ajay Chaudhary (owner-reported authority).
- Authenticated V5 tenant: `org_default`, slug `being-brilliant-academy`. UAT branch fixtures: `BBA-UAT-NDG`, `BBA-UAT-RNE`, `BBA-UAT-SHN`; **synthetic** and not verified as actual live campus master records.
- Last BBA academic and media runtime evidence: owner-operated staging, deployed `b54dca5ae36a948f83012faa4a37354198fba083`. The Phase 2 PR source successor is NOT deployed and these witnessed academic scenarios do not automatically cover changed code.
- Current Phase 2 isolated Draft #290 changes are source-only; preserve exact SHA on eventual signed acceptance. No V4 production change, no real child data, live AI evaluation, paid provider settlement or new BRANCH_ADMIN account is claimed.
- Primary existing technical evidence ledger: `docs/SCHOOLOS_V5_PHASE2_BBA_ACCEPTANCE_PROGRESS_20261030.md`.
- Original unsigned scenario disposition: `docs/SCHOOLOS_V5_PHASE2_BBA_INSTITUTION_WITNESS_PACKET_20261030.md`.
- Cross-lane legal/security/source readiness: Issue #258; #281/#293 security and #292 rollback; payment Draft #294 outside this institutional academic acceptance.

## BBA-01 through BBA-12 — observed evidence vs. outstanding human decision

| Ref | Existing operator evidence (reuse; no automatic retest) | State for human review | Exact outstanding acceptance item |
|---|---|---|---|
| BBA-01 | Tenant SUPER_ADMIN auth, three synthetic BBA branches, 3 courses/batches and five synthetic admissions including mixed grades and rejection cases | PARTIAL TECHNICAL | Verify real campus master mapping, guardian/contact workflows and institution adoption scope |
| BBA-02 | Cross-branch teacher allocation, subject/course eligibility and overlap prevention | TECHNICAL PASS | Human curriculum/timetable owner acknowledgment |
| BBA-03 | Teacher attendance and homework, authenticated student submit, teacher evaluation 8/10, duplicate/spoof/branch rejects | TECHNICAL PASS | Human learning-visibility acceptance for actual pilot roles |
| BBA-04 | Three weekly timetables, cross-branch double-booking reject; preview/save effective-allocation parity fixed only in Draft #290 | PARTIAL / SOURCE FIX UNDEPLOYED | Reconcile parity on an approved deployed SHA, or accept explicitly bounded pilot exception |
| BBA-05 | Three synthetic exams and five published report-card PDFs with invalid-case guards | PARTIAL TECHNICAL | Student/guardian-facing report authorization and academic approval decision |
| BBA-06 | Three native LiveClasses, BBA classroom roles/attendance, signed room access, WebSocket, 2-peer same-browser synthetic SFU A/V receipt | PARTIAL TECHNICAL | Decide whether separate physical-device and revoked-user cases are required or out of internal pilot scope |
| BBA-07 | Owner-operated BBA synthetic LiveKit Egress start/stop, R2 recording (741,108 bytes), authenticated student LMS MP4 playback/HTML5 decode 1280×720, cleanup | TECHNICAL PASS — SYNTHETIC | Decide cross-tenant recording download denial and signed artifact retention requirements |
| BBA-08 | Feature entitlement and three BBA synthetic exam readiness GETs; providerConfigured=false, evaluationExecutionAvailable=false | BLOCKED_BY_PHASE_1 / NO AI GRADING PASS | Secure provider+worker activation, one synthetic rubric evaluation, human marks review/checked copy and failure handling; or explicit disabled-feature exception with release policy change |
| BBA-09 | SUPER_ADMIN, teacher, student roles and cross-branch authorization PASS; no BBA BRANCH_ADMIN login; targeted source remedies in Draft #290 | PARTIAL / BLOCKED_BY_PHASE_1 | Exact security-cleared deployed Branch Admin appointment, controlled inbox setup, NDG-only scope and real RNE/SHN 403/404; current source-level user-list relation redaction must pass CI before deployment |
| BBA-10 | No new human onboarding/training witnesses in observed run | NOT WITNESSED | Name trainees, training handoff scope, date and support channel; do not invent attendance |
| BBA-11 | Phase 1 security, backup, DR are referenced elsewhere, not completed by academic acceptance | DEPENDENCY / BLOCKED_BY_PHASE_1 | Security P0 and rollback closure, student/privacy residual risk + actual signed accountable decision |
| BBA-12 | Zero-fee synthetic academic fixtures; no genuine BBA invoice settlement | NOT WITNESSED / PHASE 3 DEPENDENCY | Confirm BBA internal non-billable pilot, signed finance applicability decision, refer actual provider TEST payment acceptance to Phase 3 |

### Source-only new uncovered regression findings (not staging PASSES)

1. **Cross-branch child/teacher data disclosure risk:** `GET /api/v1/admin/users` selected a user by allowed branch but returned nested `parentChildren`, teacher/employee profiles and `branchAssignments` from *every* branch. Draft #290 now scopes every nested relation before serialization; new synthetic negative tests cover NDG vs RNE/SHN child names/admission numbers and shared teachers. Do not call this deployed or CI PASS until exact-head checks.
2. **AI evidence decision mutation after signed grading:** Oral/practical evidence create or review could run after answer-sheet `finalizedAt`, undermining evidence supporting approved marks. Draft #290 adds tenant-scoped `ExaminationAnswerSheet ... FOR UPDATE` serialization around evidence mutations and an explicit 409 finalized veto; new unit/route contract checks. A later regrade should use the distinct revision workflow.
3. **Provider error data privacy and size:** AI provider non-2xx body was previously interpolated into error text, potentially echoing sensitive student answer contents; successful response was read without a byte bound. Draft #290 now suppresses non-2xx response bodies, prevents redirects, imposes 4MiB successful-response bound and sanitizes unknown transport errors, with new synthetic negative tests. No provider credential or live AI request added.

These are newly discovered and targeted source fixes, not a request to rerun prior BBA academic/media UAT or V4 testing.

## Human reviewer decision — intentionally blank until actually completed

| Mandatory review field | Value |
|---|---|
| Reviewer / BBA signatory | Ajay Chaudhary — authorized by owner statement; no signature executed here |
| Actual reviewed date & time UTC | **NOT RECORDED** |
| Actual deployed API/Web revision, immutable image ID/digest | **NOT RECORDED FOR CHANGED PHASE 2 CODE** |
| BBA-01…BBA-12 accept / accept with conditions / reject | **DECISION NOT RECORDED** |
| Specific scope exceptions and expiration/mitigation owner | **NOT DECIDED** |
| Related-party ownership / independence conflict disclosed and waived by human | **UNSIGNED — NOT RECORDED** |
| Original protected evidence locator & SHA-256 | **NOT SUPPLIED** |
| Institution training/handover participant evidence | **NOT SUPPLIED** |
| Human signature / signed timestamp | **NOT PROVIDED** |
| Internal-pilot launch authorization | **PENDING; not commercial gate closure** |
| Formal Gate 7 and commercial GO | **PENDING / HOLD** |

**Suggested reviewer procedure when evidence available:** compare originals to exact tenant/source and scenario matrix; identify accepted exceptions individually; sign the original with actual UTC timestamp and conflict disclosure; retain in restricted document storage and post only a safe evidence locator/hash to Issue #258. Do not paste children’s data, credentials, signatures or signed legal agreements into GitHub.

## Release ledger (unchanged until new actual acceptance)

Phase 2: 3.70/5.00pp = **74% evidenced**, 1.30/5.00pp = **26% remaining**: 0.40pp Branch Admin UAT, 0.45pp AI Examiner, 0.45pp institutional signoff. Source-only fixes carry no UAT credit. Original provisional overall planning backlog 14.30pp, subject to security P0 recalibration. Formal release gates 0/10 VERIFIED, commercial GO HOLD, V4 production untouched.
