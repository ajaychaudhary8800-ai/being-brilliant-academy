# SchoolOS V5 Phase 2 — Remaining 1.30pp: gated execution plan (31 October 2026)

**Purpose:** Finish BBA institutional Phase 2 acceptance while Phase 1 owns security, credentials, image provenance and deployments.

**Evidence measurement:** Phase 2 = **3.70 / 5.00pp (74%)** operator-observed technical coverage, **1.30 / 5.00pp remaining (26%)**. Formal release gates = **0/10 VERIFIED** and commercial GO **HOLD**. Phase 1's most recently recorded credit = 2.00pp; if unchanged, combined originally planned 20pp backlog = **14.30pp**. Newly discovered P0 security incident #293 means this is a provisional planning ledger, **not a risk-adjusted launch forecast**.

## No further retests required for successful Phase 2 technical cases

Three synthetic BBA branch setups, admissions, mixed batch allocations, teacher timetable, attendance, three examinations, five report cards, student homework submission/evaluation, three native LiveKit LMS classrooms, teacher/student roles and attendance, synthetic room signaling, video/audio RTP, two-peer same-browser SFU reception, **31 October BBA synthetic provider Egress start/stop, R2 MP4 protected student stream and HTML5 decode** passed. The synthetic MP4 was **741,108 bytes** at **1280×720**; physical camera/mic not used, cleanup PASS. Tests were owner-observed, not signed human witness. Do not describe this as cross-tenant video-download denial or independent physical-device test.

## Remaining gated work (no unapproved shared staging writes)

### A. BRANCH_ADMIN role-based BBA UAT — 0.40pp (PENDING)

- Current three BBA synthetic branches used explicit deferred manager provisioning; zero BBA BRANCH_ADMIN users exist from that flow. Existing pinned backend **has no supported endpoint to attach a new BRANCH_ADMIN to an existing branch** after deferred creation. `PUT /admin/branches/:id` only patches branch metadata; do not infer manager linkage.
- The supported backend `POST /admin/branches` can atomically create **a new branch** and a **new branch-manager account** or link an existing eligible tenant-owned BRANCH_ADMIN, delivering a setup email for a newly created manager. It **cannot** reuse an existing SUPER_ADMIN email. This would add a **fourth synthetic BBA branch** if chosen, so preserve the previous three-branch fixture and document the additional test scope. Never create a real or fake uncontrolled manager email.
- **Manual dependency:** an owner-controlled, newly designated manager test inbox/account or separately reviewed manager-link feature; no email address currently verified. Do not promote an existing teacher/student to BRANCH_ADMIN, manually insert SQL identity or bypass account setup.
- After authorized provisioning: capture branch-admin login, assigned branch visibility for students/teacher/timetable/exams, 403/404 denial in another BBA branch, no access to protected super-admin operations, and original human acceptance. Only then credit this 0.40pp.
- Manager-link feature, if selected, requires separate source review and Issue #258 coordination before any staging deployment; not included in approved Phase 2 runtime.

### B. AI Examiner provider evaluation/review — 0.45pp (BLOCKED)

- Authenticated BBA read-only preflight: AI Examiner feature entitlement available, three existing BBA synthetic exams/readiness accessible, **`AI_PROVIDER_CONFIGURED=NO`** and **`AI_EVALUATION_EXECUTION_AVAILABLE=NO`**.
- Never mark marks-generation/evaluation as passed on static readiness; no provider credential or config may be changed by Phase 2.
- **Manual/coordination dependency:** Phase 1 resolve P0 #293 exposure and authorize a secured AI provider/worker setup or decide applicability of an explicitly documented disabled-feature launch exception. All changes to shared staging are governed by Issue #258.
- After the provider is actually enabled: one synthetic BBA answer-sheet/rubric evaluation, recorded AI grading trace, human-reviewed marks/checked copy, result release and failure/reconciliation evidence. Do not use real children's answer sheets. Only then credit the 0.45pp (or approved documented exception with explicit reallocation decision).

### C. Human BBA acceptance, conflict disclosure and evidence — 0.45pp (PENDING)

- Existing unsigned scenario-by-scenario packet: `docs/SCHOOLOS_V5_PHASE2_BBA_INSTITUTION_WITNESS_PACKET_20261030.md`.
- Ajay Chaudhary is the identified BBA related-party institutional UAT signatory. Owner's reported blanket approval intent **does not establish a dated signed acceptance of actual observations** or a related-party conflict waiver.
- **Manual dependency:** actually review the original tenant/revision-specific UAT outcomes and exceptions (BBA-01 through BBA-12), confirm what is out of scope, sign dated institution acceptance/related-party waiver and preserve the original in restricted storage; add only a permitted locator/hash to Issue #258. Do not manufacture a signature, timestamp or source.
- Outstanding scope decisions include real operational master branch mapping, parent/guardian role UAT, timetable parity Draft PR #290 not yet deployed, AI disabled, independent-device video, and cross-tenant recording denial. This does not change gate 7 or paid release before formal acceptance.

## Coordination / security hold

- Separate Phase 1 **P0 #293**: current V5 Web image build history contains plaintext staging PostgreSQL/Redis credentials. Keep unredacted image/config/log data restricted. Phase 2 does not inspect or rotate these secrets, replace Docker images, alter Coolify, deploy shared staging, or touch production.
- Draft Phase 2 PR **#290** and isolated branch remain **UNMERGED / UNDEPLOYED**. Any staging rollout needs Issue #258 agreed source SHA/image pair, rollout window, owner/lock and rollback evidence after Phase 1 incident mitigation.
- Preserve all passing Phase 2 operator outputs as accepted *technical* evidence; do not artificially inflate 10 formal gate status or repeated test count.
