# SchoolOS V5 customer UAT and pilot review pack

Prepared for review; no signature, approved SLA, invoice or production authorization is implied. Use with the controlled `legal-sales/` templates and `CLIENT_IMPLEMENTATION_KIT.md`. Keep completed client records in protected storage, not this public repository.

## Commercial decision sheet

| Item | Reference | Must be completed before issuing a binding offer |
|---|---|---|
| Essentials | ₹49,900/year | Actual pricebook, scope, capacity and tax review |
| Growth | ₹99,900/year | Actual pricebook, scope, capacity and tax review |
| Professional | ₹149,990/year | Actual pricebook, scope, capacity and tax review |
| Enterprise | Custom quotation | Approved module/capacity/rate schedule |
| Pilot | 60 days, ₹14,999 + GST | Start trigger, end date, scope, seats/branches, collection mechanism, refund/exit and conversion terms |
| Onboarding | Previously proposed tier estimates ₹9,999 / ₹14,999 / ₹24,999 | Resolve included-versus-separate charge in the signed SOW |
| AI/video | Paid-video monetization disabled | No unlimited-use or paid activation promise; separately approved scope and tariffs |

Do not substitute an annual checkout for a 60-day pilot. No supported automatic pilot billing flow has been demonstrated. Finance must approve a supported mechanism before collection. The pilot reference does not authorize a charge or recurring debit.

## Implementation record

Record institution, authorized sponsor, order/SOW version, candidate SHA, environment, school/coaching mode, agreed modules, branches/capacities, migration scope and named provider implementation/support owners.

Sequence: signed scope and processing terms → scoped tenant/roles → academic masters → validated migration trial → count/error reconciliation → role-based training → UAT → backup/monitoring/rollback acceptance → separate production GO. Set dates only after scope, staffing and data readiness are confirmed.

For imports, preserve original source files and record expected/imported/rejected/duplicate counts, tenant and branch mappings, remediation and client acceptance. Never borrow IDs from another tenant. Use the existing client-kit import templates and secure account-setup flow.

## Executable UAT matrix

For every row record PASS/FAIL/PENDING, tester role, timestamp, exact SHA, fixture IDs, expected/actual result, protected evidence reference and defect ID. Start all rows PENDING. Use synthetic records in isolated QA tenants for technical acceptance. Customer signoff is separate.

| ID | Scenario | Required result |
|---|---|---|
| U01 | Admin admission; edit student and guardian; duplicate validation | Correct tenant/branch record; invalid duplicate policy enforced; no unrelated records changed |
| U02 | Coaching teacher assigned at branches A and B | Authorized classes visible at both; unauthorized branch denied |
| U03 | Coaching batch contains class 5/6/7 students | Individual class levels retained; shared batch workflows work |
| U04 | School tenant attempts mixed-class/cross-branch coaching behavior | School-specific restrictions enforced |
| U05 | Teacher attendance and homework; student submission | Scoped roster, saved attendance, correct recipient and submission permissions |
| U06 | Exam creation, marks, result/report card | Correct permitted students, totals and visibility; other tenant denied |
| U07 | Timetable teacher/room overlaps | Conflicting assignment rejected; valid schedule saved |
| U08 | AI Examiner real synthetic paper | Provider output reviewed against expected marking; failure/retry and usage evidence retained |
| U09 | Teacher creates classroom; enrolled student joins | Roles and enrollment enforced; foreign/revoked user denied |
| U10 | Record classroom to R2; LMS playback/download | Actual playable recording linked to correct tenant/material; unauthorized download denied |
| U11 | Unlicensed module and role escalation attempts | Server denies access, including direct routes; authorized module still works |
| U12 | Super Admin configuration | Authorized QA change audited; tenant admin cannot perform platform operation |
| U13 | Razorpay TEST contract-to-invoice lifecycle | Real TEST capture reconciles exactly once; forged/replayed callbacks cannot grant duplicate entitlement |
| U14 | TEST refund, renewal, dispute and reconciliation | Correct approved workflow, no over-refund or duplicate ledger entry; compare provider and tenant ledger |
| U15 | Alert and isolated recovery rehearsal | Alert reaches named responder; offsite DB/files and Vault decrypt verified; rollback procedure demonstrated |

Do not bypass contract controls using fabricated signatures. If a scenario needs a genuine signed QA agreement, finance supplies the authorized test record. Never make a genuine charge. Keep video admission/settlement/zero-release flags disabled; record any incompatible paid scenario as blocked for separate authorization.

## Review routing and customer acceptance

- Engineering/QA: failed scenarios resolved, retested and traceable to final candidate.
- Operations/security: mount/source provenance, tenant/role controls, alerting, retention, restore, key custody and rollback evidence accepted. Do not claim a certification or contractual RPO/RTO from a synthetic test.
- Finance: pricebook and quote versions, onboarding decision, pilot collection/refund/conversion, tax treatment and payment reconciliation accepted.
- Counsel/privacy: review V5-specific pilot, AI/video, processing, retention/exit and support changes against the controlled pack. No assumption that V4 approval covers material V5 changes.
- Support: confirm operating channels/hours, incident owner and escalation; use only the signed SLA's response commitments.
- Customer: review actual contracted workflows, training, data reconciliation and open exceptions; sign the existing `legal-sales/11_CLIENT_HANDOVER_ACCEPTANCE.md` working copy.
- Owner: separate production GO only after all required gates and final release checks.

Leave approver identity, decision, date, signature and evidence references blank until genuinely supplied. A technical QA PASS is not customer acceptance or legal/finance approval.
