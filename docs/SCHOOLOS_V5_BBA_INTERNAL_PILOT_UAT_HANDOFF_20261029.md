# SchoolOS V5 — Being Brilliant Academy internal-pilot UAT handoff

**Prepared: 29 October 2026. Status: PREPARED / NOT EXECUTED OR SIGNED. Commercial production: HOLD.**

## Fixed scope and decision boundaries

| Field | Confirmed / current | Qualification |
| --- | --- | --- |
| Pilot institution | **Being Brilliant Academy** | Owner-operated, **internal** coaching institution; not an independent external customer |
| Authorized UAT signatory | **Ajay Chaudhary** | Ajay expressly confirmed his authority; no signed acceptance yet |
| Accountable operations/security reviewer | **Ajay Chaudhary** | Internal accountability, **not** an independent security audit or self-review substitution |
| Finance/legal reviewer | **Madhuri Verma** | Appointed; no completed decision or independent professional qualification assumed |
| Application/deployed V5 staging source | `f736e64b0e1b332aabf20557025f10b3b602b97b` | Operator reported staging API/Web revision; GitHub confirms V5 development head; do not silently bind a different deployed tenant or image digest |
| Approved working environment | `https://v5-staging.beingbrilliantedu.com` | No BBA live tenant mapping confirmed; `schoolos-qa-coaching` is a synthetic QA tenant, **not** assumed to be BBA |
| Release status | **HOLD**, all 10 formal gates **PENDING** | This file does not create signatures, transaction proof, evidence-array entries or production GO |

**Two distinct launch decisions:** (A) an **internal, non-billable, controlled BBA pilot** can be evaluated against an explicitly narrowed approved scope, with separate safety and production authorizations if applicable; (B) an **external, commercially paid release** retains the existing independent external-customer UAT requirement and every other release gate. BBA owner-signature must **not** be relabeled external-customer acceptance or used to bypass the release validator.

No real customer invoices, provider charges, signed agreements, credentials, student PII, production deployments, paid-video admission/settlement or credential rotations are authorized by this handoff.

## Existing evidence to review first — no repeated passing tests

- [Exact-source 29 Oct CI](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40873986354): API suite 1,172 passed, 0 failed, 1 skipped; overall CI success. **Automated engineering QA, not institution UAT**.
- [Exact-source isolated sandbox, job 123447962031](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40873986385/job/123447962031): 16 authenticated coaching/placement tests; one synthetic contract/HMAC lifecycle scenario; 2 signed LiveKit synthetic cases; 13 video-policy cases. See [provider evidence map](SCHOOLOS_V5_PROVIDER_EVIDENCE_MAP_20261029.md) for execution scope and missing real-provider proof.
- [Prior customer UAT matrix](SCHOOLOS_V5_CUSTOMER_UAT_AND_PILOT_REVIEW.md): scenarios U01–U15, expected outcomes and controlled acceptance process.
- [29 Oct security incident #281](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/281): staging non-API secret isolation and stored Coolify configuration corrected; QA admin login/refresh, SMTP provider authentication (no delivery), synthetic compiled Vault encryption/decryption/tamper rejection passed. Independent review pending; no repeat key rotation.
- [29 Oct restore and monitoring packet](SCHOOLOS_V5_APPROVAL_PACKET_20261029.md): isolated offsite DB/empty-uploads restore passed; 114/0 migrations; active V5 readiness/backup monitors. Full nonempty Vault/media recovery, monitor-specific alert path, incident #240 and named duty coverage remain separate.
- [Commercial issue #258](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/258): 23 Oct post-correction staging dry run reports all annual tiers aligned. Finance acceptance and original transaction audit references are still missing.

Retain each source's actual run/SHA/date and evidence quality (synthetic CI, operator assertion, actual institution observation, or signed reviewer). A test PASS in a **different** tenant is not BBA institutional acceptance.

## BBA acceptance matrix — review evidence, then capture actual pilot decisions

Every row below starts **UAT PENDING**. Technical evidence is a starting reference only. Only a human witness may record observed results, applicable exceptions and an actual BBA-specific decision.

| Ref | BBA coaching-mode acceptance | Reusable evidence / material gap | Current BBA UAT |
| --- | --- | --- | --- |
| BBA-01 | Authorized BBA tenant, branch boundaries, student/guardian admission and duplicate policy | Prior coaching admission/tenant QA; **confirm BBA tenant ID, branch mapping, and authorized test-data scope** | PENDING |
| BBA-02 | Cross-branch teacher allocation; mixed classes 5/6/7 retain individual class levels | Passing synthetic coaching allocation/placement regression; **BBA role witness and configuration still needed** | PENDING |
| BBA-03 | Attendance, homework, submission and role-restricted roster | Earlier operator QA; map original artifact, then BBA role observation where required | PENDING |
| BBA-04 | Timetable, teacher conflicts and permitted subject allocation | Earlier operator QA; confirm BBA timetable/scope | PENDING |
| BBA-05 | Exams, marks, report cards and student/guardian visibility | Earlier operator QA; map BBA grade/report-card acceptance | PENDING |
| BBA-06 | Native classroom: allocated teacher, enrolled learner, unauthorized/revoked user denied | Authenticated disposable-PostgreSQL classroom QA; actual BBA roles and provider use not evidenced here | PENDING |
| BBA-07 | If contracted: LiveKit recording, R2/LMS playback and denial of cross-tenant download | Operator-reported prior playback; retrieve provenance and verify contracted BBA scope; **paid-video controls remain OFF** | PENDING |
| BBA-08 | If contracted: AI Examiner marking review and failure/reconciliation policy | V4 QA and exact-V5 entitlement/metering policy evidence; no exact-source real-provider BBA grading acceptance inferred | PENDING |
| BBA-09 | Role segregation: BBA admin/teacher/student/parent/accountant as applicable; platform admin separation | Synthetic tenant/role checks and QA admin login; applicable BBA role list and observed outcomes not signed | PENDING |
| BBA-10 | Training, onboarding/handover, support contacts, data reconciliation and open defects | Existing implementation kit; name attendees and accept/reject migrated counts if migration applicable | PENDING |
| BBA-11 | Support/DR/privacy limitations, key custody and pilot rollback understood | DB/empty uploads restore passed; independent review, Vault/media scope and #240 disposition open | PENDING |
| BBA-12 | Finance-facing behavior **only if authorized for pilot**; test-mode receipts/quotes without real collection | Synthetic TEST coverage and owner-reported provider checks; finance must map actual TEST ledger evidence | PENDING |

### Witness record (complete privately for each applicable row)

`UAT reference | BBA tenant/branch identifier | human tester and role | observed UTC date | actual deployed SHA/image provenance | expected vs observed | PASS/FAIL/EXCEPTION/NOT-APPLICABLE | artifact locator/hash | defect/ref | signatory decision`.

Do not publish credentials, child/student personal data, tokens, provider transaction secrets or protected legal records in issues/PRs. Store signed forms and detailed tenant records in the approved restricted vault, putting only an access-controlled reference and permitted hash into the gate record.

## Decisions required from the named humans — not preapproved

**Ajay Chaudhary, BBA signatory:** confirm the genuine institution tenant and branches; select each contracted module and role; identify any scenarios truly not applicable to an **internal** coaching pilot; review existing original evidence before any new targeted BBA observation; record exceptions and accept/reject the observed internal pilot. Authority has been confirmed, **approval has not**.

**Madhuri Verma, finance/legal:** decide if the owner-operated BBA pilot is non-billable and what (if any) signed internal implementation/processing terms are needed; approve exact legal/privacy/fee scope. The `₹14,999 + GST / 60-day` pilot is a **commercial planning offer**, not automatically a charge to BBA or a supported checkout. Resolve standard onboarding inclusion versus additional ₹9,999/₹14,999/₹24,999 implementation fees, GST wording, commercial pilot caps/exit/conversion and payment evidence with the actual controlled terms. Appointment is not signoff or professional counsel certification.

**Ajay Chaudhary, operations:** designate both primary and backup responders (if no backup is appointed, explicitly record the staffing gap rather than invent coverage); document monitor alert reception, #240 residual-risk decision, immutable image rollback and nonempty file/Vault/media recovery applicability. His own assessment is **internal**; find a distinct qualified reviewer for the independent security acceptance in Gate 6.

**Independent security reviewer: UNAPPOINTED.** Must review #275/#281 historical exposure disposition and the source-to-running-image/tenant/privacy evidence. The owner cannot satisfy the independent-review requirement merely by signing the same work he operated.

## Review decision records — deliberately blank

| Decision | Authorized person | Decision/date/evidence reference |
| --- | --- | --- |
| BBA internal-pilot UAT | Ajay Chaudhary | **PENDING — no decision supplied** |
| Finance/legal scope | Madhuri Verma | **PENDING — no decision supplied** |
| Operations/support risk | Ajay Chaudhary | **PENDING — no decision supplied** |
| Independent security | **Unappointed** | **PENDING — no reviewer or decision** |
| External commercial customer UAT | **External institution not identified** | **PENDING — BBA does not substitute** |
| V5 production GO | Ajay Chaudhary | **PENDING — separate written authorization after gates** |

**Gate 7 remains PENDING.** The next executable action is to reconcile the **existing** coaching QA artifacts to the real BBA pilot tenant/module scope and obtain actual signed internal acceptance; do not rerun completed synthetic CI or assert the BBA tenant exists solely because a QA coaching tenant exists. The external commercial-release gate and all other gates remain HOLD.
