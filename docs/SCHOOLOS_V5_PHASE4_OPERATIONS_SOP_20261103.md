# SchoolOS V5 — Phase 4 operational readiness SOP and launch-day checklist

**Draft for operational review, 3 Nov 2026. Implementation: NOT ACTIVATED.** Governing release issue [#258](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/258); security incidents [#281](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/281), [#292](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/292), [#293](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/293). Do not replace existing [client onboarding](CLIENT_ONBOARDING.md), [implementation kit](CLIENT_IMPLEMENTATION_KIT.md), [administrator manual](ADMINISTRATOR_MANUAL.md), [teacher manual](TEACHER_MANUAL.md), [student manual](STUDENT_MANUAL.md), [operations](PRODUCTION_OPERATIONS.md), [incident response](INCIDENT_RESPONSE.md), [monitoring](MONITORING.md) or [launch runbook](LAUNCH_DAY_RUNBOOK.md). This V5 supplement defines deltas and handoff points; existing production SOPs are not automatically approved for V5.

## 1. Pre-onboarding gate and tenant provisioning
**Prerequisites:** approved institution and authorized purchaser/sponsor, signed scope and data terms where applicable, approved environment, correct school SECTION or coaching BATCH mode, valid plan/entitlements, named admin email, non-secret identity/contact details, permitted datasets, backup support owner. Private demos use synthetic data only. V5 commercial HOLD means this is a rehearsal procedure, not permission to create paying production tenants.

1. Intake: legal institution, campus count, mode, academic session, grades/batches, student/user estimates, migration sources/counts, tax/billing jurisdiction, support contacts, domain and intended go-live.
2. Finance verifies Order Form/plan/quota/contract policy. Onboarding work does not imply an activated subscription. Avoid reusing legacy V4 prices.
3. Platform Super Admin uses existing organization onboarding UI and enters scoped tenancy, approved plan and mode. Record environment/source revision, creator, generated tenant ID and initial provisioning audit; do not post tenant/student identifiers publicly.
4. Send one-time account setup by approved channel. **Never solicit/store passwords or send credentials in chat.** Verify role and authenticated login after explicit permitted setup.
5. Add branch: verified campus name/code/timezone, branch admin, session/grade/subjects and limits; reconcile each branch to institution. For an existing managerless branch, follow draft #290 only after it is approved, tested and deployed; **do not run a proposed endpoint as if live**.
6. School: only class/section assignments and school-mode restrictions. Coaching: course/batch groupings, permitted mixed-grade roster while retaining each student's class, explicit branch-qualified cross-branch teacher allocations. Confirm entitlements and limits before enabling LMS, live video or AI.
7. Import dry run in approved isolated environment: counts for source/accepted/rejected/duplicates, branch/student/guardian mapping, finance opening balances. Escalate mismatches. Never copy live student records into synthetic QA without authorized safeguards.
8. Teacher/student/parent setup → role-specific login and negative access check → timetable/exam/homework UAT → data reconciliation → acceptance/exceptions → protected handover.
9. Complete existing onboarding READY checklist only after verified prerequisites; **do not interpret READY UI as legal, security or commercial GO**.

## 2. Branch onboarding and change control
Branch request → validate parent organization, plan capacity and manager authority → approve access → create/update branch via supported reviewed route → attach teachers only to entitled subjects/branches → reconcile timetable preview and save → enroll learners → send secure setup instructions → sample negative cross-branch reads. Stop on duplicate branch code, unauthorized manager, existing account role conflict, unlicensed second campus or unresolved timetable allocation. Any change to shared staging waits for Phase 1 incident/rollback clearance and scheduling ownership.

## 3. Training handbooks — guided sessions
**Administrator (45–60 minute suggested training agenda, NOT an approved service commitment):** workspace sign-in, organization/branch boundaries, academic year, classes/batches and students/guardians, teacher allocations, fees/quotes and approval separation, daily attendance/timetable, exams/results publication, audit/events, support reporting, data export and role revocation. Demonstrate unauthorized branch scenario using synthetic data. Collect attendance and observed task checklist.
**Teacher (30–45 minute suggested agenda):** personal secure account setup; assigned classes/subjects; attendance; homework publish and submission review; exam marking/publish authority; live classroom admission and moderation; recording scope; privacy and escalation. Demonstrate denial for unallocated subject and foreign student; never share classroom bearer tokens.
**Student/parent (brief supervised orientation):** unique account setup through approved invitation, correct workspace and linked student identity, timetable, fee/receipt view when entitled, assigned homework and submitted work, published reports and replay access when contracted. Instruct against account sharing and sending student documents to support through unsecured messaging.
**Training evidence:** module/version, participant role, anonymized attendance count, UTC session time, exercises actually completed, accessibility/language requests, unresolved questions and restricted evidence reference. Training preparation is complete; actual delivery **PENDING_WITNESS**.

## 4. Support escalation and service levels
Existing controlled [SLA](legal-sales/05_SLA_SUPPORT_POLICY.md) proposes for paid production **P1 2 business hours; P2 4 business hours; P3 1 business day; P4 2 business days** initial response during published support hours, and a 99.5% monthly availability objective. Support: support@beingbrilliantedu.com; Monday–Saturday 09:00–18:00 IST per controlled template. **Do not publicly promise these until communications/coverage and executed Order Form are verified.** No guaranteed resolution time or RPO/RTO is implied.

| Priority | Examples | First owner | Escalate to | Stop condition |
|---|---|---|---|---|
| P1 critical | Tenant data breach, integrity loss, platform-wide outage | On-duty operational owner (designated Ajay; coverage unconfirmed) | Security/DB recovery owner and finance/legal for breach | Evidence preserved; customer/authority notification decision by accountable human |
| P2 high | Fee or examination function unavailable to many students | Application on-call (appointment pending) | Product/module owner | Customer workaround or contained fix |
| P3 normal | Individual teacher workflow issue, scoped defect | Support triage role (not yet staffed) | Module engineer | Reproduced issue with approved minimal non-PII data |
| P4 request | Configuration, training, enhancement | Support coordinator (not yet staffed) | Customer-success owner | Approved next step |

**Staffing gap:** only Ajay identified as internal operational reviewer; named backup operator, duty roster, after-hours capability and alert acknowledgments remain unverified. Do not invent a staffed helpdesk.

## 5. Incident response sequence
1. Receive monitor/helpdesk signal; classify severity and affected environment/tenant without exposing child data.
2. Assign incident ID, accountable responder, UTC start, source SHA/image/host and minimally necessary audit references; preserve originals privately.
3. Contain safely: credential/tenant compromise requires access-path review and explicit change window; no unreviewed restarts, secret rotations, paid switches or database changes.
4. Use read-only diagnostics first; determine cross-tenant blast radius, breached fields and legal/privacy reporting applicability. Notify accountable security/legal reviewers via approved channel.
5. Decide restore vs rollforward only after operator-safe verified artifact and schema compatibility; checkpoint evidence is NOT a signed application rollback.
6. Verify functional/auth/database/upload health; record status updates, #240 intermittent transport residual-risk decision and post-incident RCA; complete named human closure.
7. Close after evidence and stakeholder acknowledgment; never treat healthy HTTP 200 alone as incident closure.

## 6. Backup monitoring and disaster-recovery runbook
Reuse [V5 monitor acceptance](SCHOOLOS_V5_MONITOR_ACCEPTANCE_20261029.md), [isolated staging promotion checklist](SCHOOLOS_V5_ISOLATED_STAGING_PROMOTION_CHECKLIST_20261023.md) and operator evidence in #258. Prior evidence: nightly checkpoint creation, checksum reports, isolated DB+files restore of 20261031T073407Z, and R2-vs-local manifest parity; **these are owner-reported technical checks, not signed immutable provenance**.

- Daily: require last backup timestamp/size/checksum verification and expected R2 manifest; detect missed cron, upload failure, retention failure and incomplete backups; record only non-sensitive status.
- External readiness: observe HetrixTools off-host check and delivery of both DOWN and RECOVERY to the approved contact; monitor worker/queue failures separately. Existing Telegram backup notifications do not prove either.
- Weekly: review retention, disk headroom, object versioning where configured, job trend, credential scopes and open incident issues.
- Quarterly or on approved material change: isolated DB + file restore; extend to **nonempty** uploads/Vault ciphertext decrypt and media R2 playback when in scope; verify actual app boot and synthetic protected sentinel. Never publish a customer backup or plaintext.
- Rollback gate: immutable signed/retrievable previous API+Web pair, matching source/build provenance, protected Compose/volumes and actual schema compatibility; #292 remains OPEN. If older app on current data is unsafe, require reviewed backup+rollforward restoration with explicit data-loss and downtime decision. Keep provider keys accessible solely by authorized API components; #293 credential review/rotation awaits separate authorized staging window.
- Recovery evidence: backup ID, immutable source, checksum/authenticity, restore target, table/count/migration check, file/Vault/media scope, failover/rollback elapsed observed time, outcome, reviewer, restricted locator. **No contractual RPO/RTO until measured and approved.**

## 7. Retention, access control and tenant termination
Follow [DPA](legal-sales/06_DATA_PROCESSING_ADDENDUM.md) and [Data Exit & Retention](legal-sales/09_DATA_EXIT_RETENTION.md), not invented numeric lifetimes. Limit access to active assigned tenant roles; log privileged changes where system supports it; revoke leavers and expire service tokens; document child/guardian consent basis under approved legal policy. Export permitted tenant data in documented structured format and access-controlled channel, check per-branch totals and exported attachments, document lawful retention exceptions and purge request approval. Avoid direct deletion until legal hold, finance invoices, audit records, backup-cycle limitations and customer acknowledgment are resolved. Verify removal through scoped read-only evidence, not unsupervised SQL.

## 8. Operational readiness review checklist (all unconfirmed items remain OPEN)
- [x] Existing client onboarding, implementation-kit, manuals, incident, monitoring, legal and launch runbooks indexed; this V5 supplement prepared.
- [x] Existing 3 Nov isolated DB/files checkpoint and R2 manifest parity **referenced**, not repeated or accepted as full DR.
- [ ] Actual real BBA/customer scoped tenant roles, human training and signoff.
- [ ] Approved primary and **backup** response operator plus duty roster and reachable escalation.
- [ ] Verified notification delivery for specific external DOWN **and** RECOVERY; worker alert coverage; #240 RCA or attributable risk acceptance.
- [ ] Measured nonempty Vault/media restore or approved documented nonapplicability.
- [ ] #281 scope/risk acceptance and historical #293 credential containment/rotation.
- [ ] #292 signed compatible older image pair or approved alternate recovery.
- [ ] Approved production support SLA, data retention/privacy policy and real legal/finance terms.
- [ ] Nine prerequisite gates and separate Gate 10 production authorization.

## 9. Launch-day operations — NOT AUTHORIZED TO EXECUTE
**T−1 before any cutover:** verify pinned manifest and approved release, restricted rollback credentials, current compatible checkpoint, support/backup coverage, external monitor and customer notice; abort if any formal gate PENDING.
**T0 authorized window:** independent operator authorizes maintenance; capture exact running images and backups; execute only the pre-reviewed V5-specific deployment plan; do not change V4/main or shared staging during parallel UAT.
**T+ verification:** check readiness/dependencies and database migration, tenant and branch login boundaries, critical academic and payment negatives, media storage if contracted, alerts, incident contact and finance ledger. Record actual UTC times, pass/fail, operator and restricted artifacts.
**Abort/rollback:** stop on secret bleed, image/provenance mismatch, volume mismatch, migration incompatibility, cross-tenant reads, lost writes, provider settlement inconsistency, unavailable named responder or failed alerts. Invoke only the explicitly validated recovery path.
**Handover:** real customer acceptance, defect disposition, finance/legal approval, post-launch customer-success owner, 24h/7d monitoring review. Post-launch runbook does not imply a ready operational service.

**Phase 4 operational acceptance: PENDING.** Documentation reviewable; no monitor test, actual training, backup restoration, incident fix or activation was executed by this change.
