# SchoolOS V5 launch approval packet — 29 October 2026

**Decision: HOLD. Prepared for review; not signed acceptance.**
Observed **latest cumulative V5 development head**: `bdad9c62969dd129cf9a8309e7d5bb748ca66f27` (squash merge of Draft #285 into V5-only branch, 29 October 2026). This is **not a staging deployment or approved production release candidate**.
Operator-reported **existing staging API/Web revision**: `f736e64b0e1b332aabf20557025f10b3b602b97b`. Matching earlier staging checks and their existing CI remain historical evidence for that SHA; this session did not independently inspect the server. The exact-new-development SHA must undergo separate final cumulative workflow and build provenance review.
Development #262 and release tracking #278 remain OPEN / DRAFT.
The manifest's `releaseCandidateSha=c8c80151b6f0919552d60c5cb71af1b92d319ff5` is a historical proposed pin, NOT the current development head or an approved production RC. It is intentionally not promoted by this documentation reconciliation. An accountable reviewer must approve the immutable candidate and reconcile the manifest before release.
Documentation baseline reviewed: `fd1f3c6fc937e022aaf45fc3f3839491e85b8e8a`; subsequent documentation commits are not application image revisions.
This packet and recovery utility do not change deployed application source.

**Owner appointments incorporated (29 Oct):** Madhuri Verma = finance/legal reviewer (appointed, no review decision); Ajay Chaudhary = internal operations/security reviewer and authorized Being Brilliant Academy internal-pilot UAT signatory (appointed, no UAT or operations signoff). Independent security reviewer and external paid-customer sponsor remain unappointed. Internal BBA UAT does **not** meet the existing external-customer gate. Focused [BBA internal-pilot acceptance handoff](SCHOOLOS_V5_BBA_INTERNAL_PILOT_UAT_HANDOFF_20261029.md) is prepared for human review; no CI, QA, provider, production or signing action was executed by creating it. Formal gates remain HOLD/PENDING.

## Ten-gate register

All ten formal statuses remain PENDING (HOLD). No reviewer identity or signature is supplied by this packet.

| Gate | Required criterion and existing evidence | Source SHA / evidence date / owner | Missing evidence and next action | Sign-off authority / disposition |
| --- | --- | --- | --- | --- |
| 1. Integration | Review cumulative dependencies and approve immutable RC; #262 remains draft | f736e64b… / GitHub checked 29 Oct / repository automation | Reconcile historical manifest c8c80151… with reviewed current application; record production candidate and dependency decision | Release reviewer, identity unassigned / PENDING |
| 2. CI/provenance | Four workflows SUCCESS: [CI](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40873986354), [sandbox](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40873986385), [external QA](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40873986322), [upgrade](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40873986313) | All fetched for f736e64b… / 29 Oct / GitHub Actions | Independent run review and checkout-to-immutable-image provenance; no repeat runs solely for paperwork | Build/release reviewer, unassigned / PENDING |
| 3. Migration/DR | 114/0 migrations, 336 tables, readback/amcheck PASS, zero invalid indexes; empty-upload restore and cleanup PASS | Backup 20261028T020001Z; restore source revision not bound by terminal output / 29 Oct / Ajay operator | Review existing rehearsal; identify nonempty uploads, Vault/key and recording stores, applicability and recovery evidence | Recovery reviewer, unassigned / PENDING |
| 4. Subscription/TEST | Owner-reported Razorpay TEST and reconciliation completed | Exact transaction/source binding absent / carried forward 29 Oct / owner | Index existing contract, capture, callback forgery/replay, refund, dispute, renewal and ledger artifacts; test only uncovered applicable cases | Finance/payment reviewer, unassigned / PENDING |
| 5. AI/video | Owner reports classroom, recording, LMS playback; AI Examiner QA from V4 | V5 execution SHA/date not established for all artifacts / owner | Retrieve provider evidence and review material V4-to-V5 changes; paid-video controls remain OFF | Product/provider reviewer, unassigned / PENDING |
| 6. Security/privacy | Six non-API services core/media counts zero; protected API file/mount and persisted Coolify configuration PASS; login, SMTP auth and synthetic compiled Vault PASS; issue #281 | f736e64b… reported staging / 29 Oct / Ajay operator | Independent incident review, exposure decision, tenant/privacy/load evidence; distinguish synthetic crypto from historical document recovery/authorization | Independent security reviewer, unassigned / PENDING |
| 7. Customer UAT | Existing synthetic coaching QA; BBA internal-pilot sponsor and authority confirmed, but no UAT signature | f736e64b… operator-reported staging; 29 Oct owner appointment | Bind real BBA tenant/modules/roles, capture actual internal UAT; independent external-customer acceptance still required for paid release | Ajay Chaudhary, BBA internal signatory APPOINTED; external sponsor unassigned / PENDING |
| 8. Operations | Backup monitor active with prior Telegram delivery; HetrixTools readiness active and Default Contact assigned | Service configuration evidence, not image provenance / 29 Oct / operator | Monitor-specific alert receipt, worker coverage, named primary/backup duty cover, retention/rollback and #240 disposition | Ajay Chaudhary, internal operations reviewer APPOINTED; decision PENDING |
| 9. Commercial/legal | 23 Oct dry run: 49,900 / 99,900 / 149,990 ALIGNED; Enterprise custom; 60-day pilot reference 14,999 + GST | Runtime SHA and apply audit ID absent / 23 Oct operator, reconciled 29 Oct | Accept pricebook and transaction evidence; clarify non-billable internal BBA pilot versus paid offer; onboarding, tax/privacy/DPA and signed terms | Madhuri Verma, finance/legal APPOINTED; decision PENDING |
| 10. Production GO | No production authorization | No approved production RC / current record | After gates 1–9, approve named target, immutable images, compatible rollback and separate written GO | Ajay / authorized production owner / PENDING |

All source abbreviations above refer to the full development SHA at the top only where explicitly attributed; historical/operator evidence is not silently rebound to that SHA.

Prior recorded validator result: HOLD, 0/10 VERIFIED, zero validation errors. This reconciliation does not claim a new validator execution or alter gate statuses.
Planning estimate: unchanged 80% complete / 20% remaining. Not a measured gate score.

## Recovery utility review and execution handoff

Original: `schoolos_v5_isolated_restore_20261028.py`.
Reviewed replacement: `scripts/schoolos_v5_isolated_restore_20261029.py`.

The original bound a host backup directory into a postgres-user container; restrictive host directory permissions could prevent pg_restore from reading it. It left restored uploads behind and checked migration counts without full restored data readback.

Replacement:
- Reuses the exact existing downloaded backup; no download or backup-checksum repetition.
- Reads only the live V5 container image identifier; never connects to a live database.
- Uses a random labelled, network-none container with no published ports or host/volume mounts; database stays in bounded tmpfs.
- Streams the protected dump through stdin without changing host permissions.
- Caps memory, swap, CPU and process count; checks temporary headroom.
- Checks 114/0 migrations, invalid indexes, application table presence, complete pg_dump readback and pg_amcheck.
- Rejects archive traversal, links, device entries, duplicate normalized paths and excessive extraction size; compares extracted bytes to archive streams.
- Cleans labelled disposable container and extracted temporary files independently; never removes Docker volumes or original downloads.
- Emits aggregate counts/timing only. Final PASS requires cleanup success.

Local validation: Python compilation PASS; four archive/digest unit tests PASS (including unsafe entry subcases). **Initial local validation did not execute Docker/VPS; operator subsequently executed the script successfully (see update below).** pg_amcheck must exist in the existing PostgreSQL image; missing utilities or tmpfs capacity failure are FAIL, not grounds to weaken checks.
If stopped by SIGKILL or host loss, finally cannot run: operator must inspect only the unique recovery-labelled container and its temporary extraction directory before removal. Never use volume prune.

Execution dependency: this session's SSH connection to the supplied VPS IP returned “Network is unreachable”; Cloud Browser inventory contained no existing tabs or authenticated infrastructure session. The owner subsequently executed the utility through their VPS terminal; assistant infrastructure access remains unavailable.
After copying the reviewed utility to the VPS, execute:
```sh
python3 /root/schoolos_v5_isolated_restore_20261029.py
```
Retain sanitized output, UTC start/end, script commit, backup identifier, exit status and independent reviewer identity. Do not mark success from local unit tests.
Recovery duration measures this already-downloaded restore rehearsal, not end-to-end disaster RTO; download/provisioning/key acquisition and customer validation are excluded. Backup age alone is not measured achieved RPO. Vault encrypted-document/key recovery remains separate.

## Security and incident disposition

#275: operational remediation completed on operator evidence; independent security acceptance outstanding. Do not rotate again or close solely from this packet.

#240: unresolved recurrent external transport/browser timeouts, including 23 and 27 October. Existing fail-closed diagnostics and DOM-ready navigation mitigation do not establish cause. Disposition: **OPEN / operations release HOLD**, not silently waived.
Required evidence: correlate failure UTC windows from runs 39916966876, 39919943377, 39944051108 and 40486963071 with origin proxy/container restarts, DNS/TLS path and any edge WAF/rate-limit events. Record evidence unavailable due to retention if applicable. If cause cannot be recovered, an accountable operations reviewer must explicitly accept residual risk with observation window, alert routing, recurrence action and review date; no such acceptance exists here.

## Monitoring, support and recovery readiness

Directly fetched candidate `.github/workflows/uptime-monitor.yml` targets `beingbrilliantedu.com` and `main-staging.beingbrilliantedu.com`; **it does not target V5 staging**. Existing external V5 QA is not proof of continuous monitoring.
The V5 HetrixTools readiness monitor is now active with Default Contact assigned; do not repeat its setup. Review remaining homepage/operational/worker coverage in the existing monitoring platform. Require exact HTTPS target, bounded connect/response time, redacted failures, persistent incident and human notification. Prove alert delivery using an isolated synthetic monitor test; do not cause a live outage. GitHub scheduled workflows on a non-default draft branch are not evidence of an active schedule. Do not alter main to activate monitoring in this task.

Existing support policy documents 99.5% availability objective, P1/P2 response of 2/4 business hours, Mon–Sat 09:00–18:00 IST and critical escalation. Those document statements do not prove staffed coverage or delivered messages. Confirm published contact ownership, primary/backup duty persons, escalation availability and actual delivery before contractual reliance.
Confirm offsite retention and independently recoverable backup/Vault keys without revealing values. Do not present a generic production-path restore claim as this V5 backup's completed recovery.

## Commercial reconciliation

| Item | Approved planning reference | Closure needed |
| --- | --- | --- |
| Essentials annual | INR 49,900 | Accepted current pricebook evidence |
| Growth annual | INR 99,900 | 23 Oct post-correction operator-reported staging dry run shows ₹99,900 ALIGNED; reconcile transaction audit/finance acceptance, not assumed new drift |
| Professional annual | INR 149,990 | Accepted current pricebook evidence |
| Enterprise | Custom quotation | Approved scope and quotation |
| Pilot | 60 days, INR 14,999 + applicable GST | Inclusions, caps, refund/exit and annual conversion terms |
| Onboarding | Referenced 9,999 / 14,999 / 24,999 | Resolve included-standard-onboarding versus separately charged implementation |

Do not alter existing quotations/invoices or issue binding offers from planning references.
No current signed customer UAT, legal or finance approval was supplied or located in the reviewed GitHub evidence. A targeted file search surfaced historical handoffs, not a signed acceptance document; this is not proof none exists.
Required reviewers: actual customer sponsor; finance accountable person; legal/privacy reviewer; operations and security reviewers. Record actual identity, role, date, scope, candidate SHA, artifact reference/hash, exceptions and decision. Do not prefill PASS or sign on anyone's behalf.

## Production cutover and rollback — prepared, not executable approval

Before GO, complete these concrete blanks: approved production topology/project and domain; immutable V5 API/Web image digests; currently deployed V4 rollback digests and configuration reference; full V4-to-candidate migration delta and compatibility decision; backup ID and Vault/key recovery proof; maintenance window; release commander, operations/finance/support owners; monitoring/alert proof; customer communication approval. None is inferred from staging tags.

Sequence after separate explicit production authorization only:
1. Pin reviewed release and immutable images; verify gates 1–9 and owner GO without relaxing validator.
2. Confirm no intervening code/config drift; take approved production checkpoint and verify its independent restore readiness.
3. Apply reviewed writer-freeze/maintenance plan if migrations require it; preserve queued callbacks and uploads.
4. Execute approved migration/deployment plan in the explicitly named production target; do not reuse staging database/volumes.
5. Validate migration completion, ready/operational health, login, tenant isolation and one representative workflow; verify background workers and backup monitor.
6. Keep live payments and paid-video flags OFF unless separately authorized; production deployment approval alone does not enable them.
7. Observe the agreed window and obtain operator handover; communicate only through separately authorized channels.

Abort/rollback: any tenant leakage, data-integrity failure, failed migrations/readiness or broad login failure triggers incident command and write freeze. Preserve evidence. Application-only rollback is allowed only when DB backward compatibility is established. Otherwise restore a coordinated database+uploads checkpoint into an isolated target, validate, then switch only under explicit recovery authorization. Never blindly run old images over incompatible migrations. Preserve failed state and reconcile external callbacks/payments before resuming writers.
No immutable production rollback identifiers have been independently collected in this session; rollback readiness remains HOLD.

## Operator recovery result — 29 October 2026

Ajay supplied terminal output from `root@srv1880999` executing `python3 /root/schoolos_v5_isolated_restore_20261029.py`. This is operator-supplied runtime evidence, not an independently observed execution or signed gate review. Intended backup: `20261028T020001Z` in the already-verified download directory. No repeat download or checksum run requested.

```text
OFFSITE_DATABASE_RESTORE=PASS
RESTORED_MIGRATIONS=114
RESTORED_UNRESOLVED_MIGRATIONS=0
DATABASE_READBACK=PASS
DATABASE_AMCHECK=PASS
INVALID_INDEXES=0
RESTORED_PUBLIC_TABLES=336
OFFSITE_UPLOADS_RESTORE=PASS
RESTORED_FILE_COUNT=0
RESTORED_FILE_BYTES=0
RECOVERY_DATA_SECONDS=8.9
TEMPORARY_RESOURCES_CLEANED=YES
RESTORE_TOTAL_SECONDS=9.3
RESTORE_TEST=PASS
LIVE_DATABASE_CONNECTIONS=NONE
EXISTING_VOLUMES_CHANGED=NO
CREDENTIAL_VALUES_PRINTED=NO
```

This closes the pending execution of this isolated database/empty-uploads recovery rehearsal. Do not rerun it solely for signoff. 9.3 seconds is local rehearsal elapsed time, not contractual or end-to-end disaster RTO. Zero files means empty-archive handling passed; no nonempty uploads, encrypted Vault documents or external LiveKit recordings were restored by this run. The output does not establish whether those separate stores should contain data; reconcile storage scope before claiming complete document/media recovery.

Remaining for gates 3/8: attributed independent review, separate Vault/key and recording-storage recovery scope, monitoring/alert delivery, retention, incident #240 disposition and immutable rollback references. All ten formal statuses remain PENDING/HOLD; no approvals invented. Planning estimate stays 80% because no calibrated weighting supports a numerical increase.

## External monitor evidence update — 29 October 2026

The owner subsequently provided a HetrixTools screenshot for `SchoolOS V5 Readiness`: **Online**, externally monitored since 29 October 2026, one-minute interval, 10-second timeout, 446.07 ms recent average load and 100% uptime over the monitor's short life (22 minutes online at capture). VPS curl returned readiness HTTP 200, certificate verification code 0 (valid), 0.182195-second total. These are operator-supplied observations; earlier off-host slow samples and unresolved historical #240 are not erased. Full audit: `docs/SCHOOLOS_V5_MONITOR_ACCEPTANCE_20261029.md`.

**Gate 8 adjustment:** External V5 readiness monitoring is evidenced **active**; setup need not be repeated. Owner also reported saving a Chat ID and receiving a Telegram message during the HetrixTools setup sequence; exact sender/contact-list binding and down/recovery event delivery are not independently established. Default Contact assignment is now evidenced. Still missing monitor-specific failure/recovery alert delivery, worker/operational checks, responsible responders and accountable #240 disposition. Coolify backup Telegram is a separate route. Keep gate 8 PENDING, overall 0/10 independently signed VERIFIED and production HOLD. No live outage test or redeployment is authorized by this evidence.

## Pricebook evidence chronology — 29 October reconciliation

A dated [23 October GitHub issue #258 entry](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/258#issuecomment-6371294472) records **operator-supplied** post-correction staging dry-run evidence: Essentials 4,990,000 paise, Growth 9,990,000 paise, Professional 14,999,000 paise all ALIGNED; `blocked=0`, `changed=0`, no external issuance and no production mutation. The Growth amount 9,999,000 paise was expressly the **prior** drift, not the amount measured in that final 23 October dry run. Later 27 October design/PR commentary referencing ₹99,990 is not a fresh actual staging database reading; do not misclassify it as proof of renewed drift.

Limit: the recorded output lacks the staging apply transaction/audit ID and is operator-attested rather than independently finance-signed. Volume preservation during subsequent redeploy is encouraging, but not a substitute for dated current ratebook acceptance. Do not repeat an already-successful price change or run a new `--apply` without fresh independent drift evidence and explicit finance authorization. Formal finance gate remains PENDING; pilot/onboarding terms, tax, privacy, contracts and finance signature remain open.

A targeted connected Drive/Gmail title/keyword search found no signed SchoolOS UAT/finance acceptance in those returned matches. This is a bounded search result only, not evidence that such documents do not exist elsewhere.

## Security acceptance dossier and bounded remaining actions

Technical remediation is operator-verified, not independently signed. Latest positive evidence supersedes intermediate process-discovery failures in #281:
- [Login and page-refresh acceptance](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/281#issuecomment-6497535028): does not prove token revocation or full multi-role acceptance.
- [SMTP authentication](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/281#issuecomment-6497585664): EMAIL_SENT=NO; retrieve previous delivery evidence before proposing another send.
- [Compiled Vault encryption/decryption/tamper rejection](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/281#issuecomment-6497797717): synthetic data only, no existing records changed; does not establish historical document readability, admin authorization or offsite key recovery.
- [Consolidated runtime/source checkpoint](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/258#issuecomment-6497890364): records source, isolation, stored configuration and backup checks.

Security reviewer decision record remains blank: reviewer identity/role; review timestamp; exact artifact and source references; exposure window and access scope; evidence of exploitation or explicit absence of evidence (not proof of absence); reasoned key-preservation/rotation decision; residual risks; acceptance/rejection; signature reference. Do not rotate preserved JWT/Vault keys or close #281/#275 merely to fill the record.

For #240, [final bounded journal assessment](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/240#issuecomment-6488883401) already found only init/cron/guest-agent source metadata in 18 retained entries. Current container logs postdate failures. Do not repeat that search. Review external archives if available; otherwise operations must explicitly decide residual risk, observation period, browser checks, alert recipient/acknowledgment, recurrence response and review date. Root cause remains unproven.

## Customer and commercial acceptance handoff

Reuse successful QA; each reviewer records only uncovered requirements or material changes. The acceptance record must identify institution, authorized sponsor, deployment/source, actual test dates and evidence, school/coaching scope and applicable admin/teacher/student/parent roles, onboarding handover, accepted exceptions and signed decision. Internal QA is not an external customer signature.

Finance must map existing TEST transaction IDs to contract/quote version, subscription state, capture/refund/webhook event and ledger result without placing secrets or customer legal documents in repository files. Mark nonapplicable cases with reason and accountable approval, not fabricated PASS.

Commercial decisions still required: whether standard remote onboarding is included and when the 9,999/14,999/24,999 implementation fees apply; pilot module/student/branch caps, support and migration inclusions, refund/exit and annual-conversion rules; approved tax and privacy/DPA terms. Prices here are planning references, not binding offers. Keep paid-video monetization disabled.

Next executable work depends on existing evidence access: locate private provider/customer/commercial artifacts, map them to the rows above, then obtain accountable acceptance. No additional credentials, customer signatures, reviewer identities, financial transactions or production approval were inferred by this reconciliation.

## Owner-confirmed appointment blocker and reviewer handoff

On 29 October 2026, Ajay confirmed that the requested reviewers and pilot institution have **not been appointed yet**. Historical status: AWAITING_APPOINTMENTS, superseded by the owner appointments below. This is an explicit owner statement, not merely an unsuccessful document search. No appointment, engagement, fee commitment or external communication has been made by this packet.

### Appointment scopes ready for use

| Role | Review scope | Existing material to start with | Required output |
| --- | --- | --- | --- |
| Independent security reviewer | Credential exposure #275/#281, current isolation evidence, tenant/role/privacy controls, key custody and historical-document access | This packet; security source review; provider evidence map; dated operator results | Attributed accept/reject decision, exposure assessment, exceptions and any narrowly justified missing test |
| Operations/recovery reviewer | Restore scope, nonempty uploads/Vault/recordings where applicable, monitor delivery, duty cover, #240, image provenance and compatible rollback | Recovery result; monitor acceptance; incident #240 evidence; existing CI and source references | Recovery/operations decision, named primary/backup responder, alert proof, immutable rollback references and incident risk disposition |
| Finance reviewer | Existing Razorpay TEST capture/refund/reconciliation, subscription/renewal scope, pricebook and onboarding/pilot commercial terms | Provider evidence map and existing transaction records supplied privately | Transaction-to-ledger reconciliation and approved commercial scope with dated exceptions |
| Legal/privacy reviewer | Applicable V5 changes to existing controlled contracts, pilot terms, data processing/privacy, liability/support and approved tax wording | Existing legal-sales pack plus commercial decisions in this packet | Exact accepted document versions, exclusions/changes and attributable review decision |
| External institution sponsor | Contracted school/coaching workflows, roles, onboarding and operational handover | Existing functional QA plus institution-specific acceptance scope | Authorized sponsor identity, actual UAT record, exceptions and signed customer acceptance |

One qualified person may cover compatible roles; do not represent self-review or an AI-produced packet as independent acceptance. No qualification, authority or conflict-of-interest assessment has yet been completed for any prospective reviewer.

### Review procedure that avoids repeated testing

1. Reviewer reads the indexed evidence before requesting execution. Start with [provider evidence mapping](SCHOOLOS_V5_PROVIDER_EVIDENCE_MAP_20261029.md), which now includes the AI source delta and existing payment/renewal coverage.
2. Classify each criterion as supported by existing evidence, missing artifact, material uncovered behavior, or explicitly nonapplicable subject to the accountable reviewer decision.
3. For missing artifacts, retrieve the original record first. A missing document does not prove a test failed or must be repeated.
4. Request a targeted test only for material changed behavior, invalid evidence or an uncovered requirement, documenting why existing evidence is insufficient. No blanket rerun, repeat key rotation, repeated restore or outage simulation.
5. Record review identity, role, UTC date, exact source and artifact references, acceptance/rejection, exceptions and signature reference. Leave these fields blank until supplied by the actual reviewer.
6. Technical acceptance does not authorize production. Keep all ten gates PENDING until their individual criteria and authentic approval are satisfied; separate owner GO remains last.

### Customer UAT scope to finalize with the appointed sponsor

| Area | Scope decision and evidence needed |
| --- | --- |
| Institution | Legal institution identity, authorized sponsor and agreed school or coaching mode; internal BBA QA is not an external signature |
| Roles | Applicable admin, teacher, student/parent and accountant access; use existing role/tenant QA for technical evidence |
| Contracted workflows | Admissions/placement, timetable, attendance, fees, examinations/report cards, LMS/classroom only as contracted |
| Onboarding | Approved migration scope, training attendees, support handover and access ownership |
| Acceptance | Dated observed outcomes, unresolved defects, accepted exceptions, authorized signature and release/source reference |

Use synthetic or explicitly authorized institution data; do not enroll a prospect or issue credentials/contracts merely to fill this table. Do not promise disabled monetization, unsupported service levels or an unapproved launch date.

### Remaining owner decisions

- Name the reviewers and pilot institution, then provide their authorized scope. This packet is ready; no one has been contacted.
- Resolve standard onboarding included versus separately scoped implementation fees.
- Confirm pilot inclusions, capacity, support, exit/refund and annual-conversion terms with finance/legal.
- After evidence acceptance and an immutable cutover/rollback plan, provide separate explicit production authorization.

Further copies of this checklist cannot close these dependencies. Source review and evidence preparation can be reused; next gate closure requires appointments, existing external records or actual accountable decisions. No completed tests were rerun for this handoff.

## Owner appointments — 29 October 2026

This section supersedes earlier statements that no reviewers were appointed. Ajay supplied these assignments directly in the project conversation. They are appointments, not signatures, completed reviews or production authorization.

| Responsibility | Appointed person | Current acceptance status |
| --- | --- | --- |
| Finance/legal review | Madhuri Verma | APPOINTED; review decision and accepted document versions pending. Professional qualification or external legal certification is not inferred |
| Security/operations review | Ajay Chaudhary | APPOINTED as accountable internal reviewer/operator; independent security acceptance not established |
| Pilot UAT signatory | Ajay Chaudhary | APPOINTED for Being Brilliant Academy; owner confirms signing authority. Actual UAT decision pending |
| Final production owner | Ajay Chaudhary | Separate production GO remains pending after prerequisites |

Ajay also supplied staging operator evidence and owns the release decision. His appointment can establish internal operational accountability but does not by itself establish independent review of his own execution. The existing independent security requirement remains unresolved; no silent waiver or substituted external reviewer is recorded.

The owner subsequently identified Being Brilliant Academy and expressly confirmed authority to sign its UAT. This is an internal/owner-operated pilot, not independent external customer acceptance.

### Next review actions

- Madhuri reviews the commercial/finance evidence and exact contract/privacy/pilot/onboarding versions, records findings and accepts or rejects the scope in her own attributed decision. Appointment does not establish payment reconciliation or legal approval.
- Ajay reviews operations evidence, confirms primary/backup response cover and records the #240 disposition, recovery limitations and rollback references. His internal decision remains distinct from independent security acceptance.
- Pilot identity and owner-confirmed signing authority are established for Being Brilliant Academy / Ajay Chaudhary. Bind the agreed UAT scope, source/deployment and actual acceptance decision to that institution.
- Identify how independent security review will be satisfied under the existing release requirements. Any proposed governance change must be explicit and must not relabel self-review as independent.
- Reuse passed tests. New execution requires an identified material gap; no test, workflow or provider transaction was rerun to record these appointments.

All ten formal gate statuses remain PENDING and commercial release remains HOLD. No message or invitation was sent to any appointee.

## Pilot institution confirmation — 29 October 2026

Owner statement: Being Brilliant Academy; Ajay Chaudhary confirms he is authorized to sign its UAT.

- Institution: **Being Brilliant Academy**.
- Pilot classification: **internal, owner-operated coaching institution**.
- Authorized UAT signatory: **Ajay Chaudhary**, authority confirmed by his direct statement; no separate authority document independently examined.
- Appointment/identity dependency: **RESOLVED for the internal pilot**.
- UAT execution and signed acceptance: **PENDING**; the statement confirms authority, not acceptance of tested behavior.
- Scope: prepare coaching-mode acceptance using existing coaching QA. Exact deployed tenant identifier, branches, contracted modules and acceptance evidence must be bound to this pilot; do not assume the synthetic schoolos-qa-coaching tenant is the operational institution.
- Existing tests: reuse applicable passing results with original provenance; do not rerun them simply because the sponsor is now named.
- External-customer acceptance: **not established**. The existing Gate 7 requirement for an external institution cannot be marked satisfied by this internal appointment. An internal-pilot versus general commercial-release scope decision must remain explicit.
- Production, real payments and paid-video activation: **not authorized by this confirmation**.

Next concrete UAT step is an attributed review of the existing coaching evidence against the actual internal-pilot scope, recording accepted workflows, exceptions and decision. No customer onboarding, account creation, test run, signature or production action was performed to record this confirmation.

## Next V5 development checkpoint — 29 October 2026, after PR #285 squash merge

**Development-only:** PR #285 `fix(v5): prevent BBA internal-pilot UAT from satisfying paid customer release gate` was reviewed for scope and passed **both exact-PR-head CI jobs** at `5ef36929d82e1c6dee4024763054ec9cade97dab`; unrelated external workflow was **SKIPPED** because its jobs require a `feature/schoolos-v5-` PR head. This skipped run was not falsely recorded as success. PR #285 was then squash-merged **only into isolated cumulative V5 development** at `bdad9c62969dd129cf9a8309e7d5bb748ca66f27`, not V4 `main`.

This change tightens the paid release `customer_uat` policy: declared `INDEPENDENT_EXTERNAL` institutional relationship plus restricted original signed-acceptance references are mandatory; an owner-operated BBA internal UAT or generic review cannot satisfy it. Three policy-negative regressions were added. It is **metadata validation**, not verification of signature authenticity or reviewer independence. A human must inspect the genuine original record.

Four **cumulative development SHA** GitHub workflows were dispatched by the merged branch's existing PR event: CI `40904313252`, sandbox `40904313286`, external QA `40904312517`, V4 isolated upgrade `40904312589`. At preparation of this checkpoint their final conclusions were not all available; inspect results rather than inheriting PR-head success. Historical f736 evidence need not be rerun to certify unchanged payment/LiveKit code, but new source must pass its current release-control tests.

**No Coolify staging redeploy, production/V4 mutation, user/customer payment, access credential rotation, UAT signature, finance approval or new release candidate pin.** Existing V5 staging remains last operator-evidenced `f736e64b...`; `releaseCandidateSha` remains historical `c8c80151...` with **HOLD / 10 PENDING / 0 VERIFIED** until actual independent release/governance acceptance.
