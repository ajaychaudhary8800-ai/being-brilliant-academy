# SchoolOS V5 — provider evidence mapping and remaining acceptance

Reviewed 29 October 2026. **HOLD; not a signature or production authorization.**
Application source: `f736e64b0e1b332aabf20557025f10b3b602b97b`.
Documentation baseline: `fd800efe709dac9ea86ea5d024bf4c7b112acbb8`.
All times below are UTC. Observation is a read of existing GitHub source/logs, not newly executed provider transactions.

## Evidence that actually executed

[Sandbox run 40873986385, job 123447962031](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40873986385/job/123447962031) completed successfully at the exact application source. Workflow explicitly checks out PR head, uses disposable localhost PostgreSQL and synthetic credentials. Retrieved job logs establish:

| Logged test group | Time | Result | Scope |
| --- | --- | --- | --- |
| Academic placement and authenticated coaching HTTP | 12:32:33 | 16 passed, 0 failed, 0 skipped | Disposable DB; tenant/branch authorization, placement constraints and concurrency |
| Consent-based private-demo CRM HTTP | 12:32:34 | 1 passed, 0 failed, 0 skipped | Synthetic lead; not actual customer acquisition |
| Signed-quote HTTP and HMAC webhook lifecycle | 12:32:36 | 1 passed, 0 failed, 0 skipped | One integrated scenario with multiple assertions below |
| Signed LiveKit evidence and cutoff selection | 12:32:38 | 2 passed, 0 failed, 0 skipped | Synthetic signed provider events; local PostgreSQL |
| Video admission/end policy and route contracts | 12:32:40 | 13 passed, 0 failed, 0 skipped | Includes provider refusal/unreachable/still-active-room negative cases |

These are per-group counts, not a whole-repository total. They resolve whether these tests executed; they do not convert simulations into provider acceptance.

## Payment requirement mapping

Source: [schoolos-contract-checkout-idempotency.integration.test.ts](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/blob/f736e64b0e1b332aabf20557025f10b3b602b97b/apps/api/src/integration/schoolos-contract-checkout-idempotency.integration.test.ts).
The source refuses non-local/non-test DB targets and non-synthetic credential settings. Contract/document fixture is explicitly synthetic.

| Requirement | Assertions inspected in passing scenario | Remaining external evidence |
| --- | --- | --- |
| Tenant and contract boundary | Foreign quote 404; missing contract 409; invoice count unchanged | Genuine QA contract/document acceptance, authorized tenant linkage |
| Retry safety | Same invoice/order reused; one invoice remains | Existing Razorpay TEST order identity and actual retry evidence |
| Callback authenticity | Missing/forged signatures 400; signed wrong amount 422 | Actual provider webhook delivery and raw-body verification artifact |
| Failure handling | Signed failure replay idempotent; FAILED identity cannot become CAPTURED; late failure preserves capture | Existing failed-then-captured provider attempts with distinct valid identities |
| Capture concurrency | Concurrent identical signed captures and later replay 200; conflicting identity/content 409; one payment/event | Provider capture ID mapped to invoice, quote, subscription and ledger |
| Entitlement state | Invoice/quote PAID; organization ACTIVE and plan entitlements enforced | Finance reconciliation of actual TEST capture and granted scope |
| Refund protections | Incorrect linked payment rejected; replay creates one adjustment/hold revision; excess refund rejected; paid invoice preserved | Provider TEST refund and finance-approved risk-hold/ledger disposition |
| Dispute and renewal | Not established by this single HTTP scenario | Map separate existing evidence; do not label missing mapping as failed execution |

Owner previously reports actual TEST/reconciliation completion. Reuse that evidence when accessible; do not create another order/refund solely for this document. Current reviewed material lacks the attributable provider transaction-to-ledger artifact package. No live payment or billing activation is authorized.

## LiveKit and AI requirement mapping

Source: [schoolos-livekit-signed-webhook-e2e.integration.test.ts](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/blob/f736e64b0e1b332aabf20557025f10b3b602b97b/apps/api/src/integration/schoolos-livekit-signed-webhook-e2e.integration.test.ts).

The executed test covers authenticated synthetic event ingestion, reverse delivery order, duplicate/reused event IDs, modified raw bytes, missing auth, uninvited participants, disabled tenant, unknown room, cross-tenant preview rejection, 75-second/2-minute preview, no usage debit, and late evidence invalidating a pending review.
Separate passing policy/contract cases cover provider disconnect refusal and unavailable room verification. These are not proof of real cloud delivery or historical provider costs.

Owner-reported teacher/student classroom, recording and LMS playback remain useful positive evidence. Obtain their original date/source/room/recording references and reviewer acceptance; never expose signed playback URLs or credentials in public records.
AI Examiner evidence is from V4 unless an artifact explicitly establishes V5 execution. The subsequent AI delta review below narrows the source changes against the exact repository main baseline; it does not attest the deployed V4 image. Independent provider acceptance remains open.
Paid-video admission/settlement/monetization remain OFF. An accountable release reviewer must explicitly decide the scope of disabled monetization evidence; this document neither waives a gate nor requires activation to test it.

## Exact source delta and reuse limits

[Compare historical proposed candidate to current application](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/compare/c8c80151b6f0919552d60c5cb71af1b92d319ff5...f736e64b0e1b332aabf20557025f10b3b602b97b): 4 commits ahead, 0 behind; five changed files:
- `apps/api/docker-entrypoint.sh`
- `docker-compose.schoolos-v5-staging.yml`
- `scripts/check-schoolos-v5-media-file-credentials.test.mjs`
- `scripts/schoolos-v5-staging-provenance.mjs`
- `scripts/schoolos-v5-staging-provenance.test.mjs`

No migration, payment business-logic or AI/classroom business-logic file appears in this bounded delta. Credential loading does affect runtime integration, so retained post-cutover login/SMTP/Vault tests matter. This does not prove equivalence to V4, certify deployed image digests or approve the immutable production candidate.

## Bounded private-evidence search

Connected Drive keyword searches for SchoolOS, Razorpay and UAT returned no matches.
Gmail search from 1 October 2026 for SchoolOS/Being Brilliant acceptance/UAT/Razorpay/signed terms initially returned GitHub notifications; a targeted search excluding GitHub notifications returned no matches.
This describes the accessible query results only, not proof that acceptance records do not exist. No mail sent, signatures synthesized or private contract content copied to GitHub.

## Concrete handoff required to close remaining gaps

| Responsible party | Existing evidence or decision to supply | Completion condition |
| --- | --- | --- |
| Payment/finance reviewer | Existing TEST transaction/contract/ledger package; applicable dispute/renewal evidence | Attributed, dated acceptance tied to reviewed source and tenant |
| Security/recovery reviewer | Review #281/#275 remediation, exposure disposition and applicable stored Vault/key/media recovery evidence | Explicit signed decision with exceptions and recovery scope |
| Operations reviewer | Existing alert event/receipt, primary/backup duty cover, immutable rollback references; #240 residual-risk decision | Traceable failure/recovery notification and accountable operational acceptance |
| Customer sponsor | Institution, contracted role/module scope and existing UAT/onboarding record | Genuine authorized customer acceptance |
| Commercial owner/legal/finance | Onboarding included versus separately scoped fees, pilot caps/exit/conversion, current legal/tax/privacy terms | One internally approved commercial scope and acceptance record |
| Release reviewer/owner | Approved immutable RC and images, all prior acceptance, exact production target and rollback | Separate production GO after prerequisites |

No request has been sent to these parties. Identities are unassigned unless independently supplied. Signed/private records should remain in approved access-controlled storage; repository evidence contains safe references and actual reviewer metadata only.

## Register validation

Only `nextAction` prose was reconciled; historical candidate pin, HOLD, all ten PENDING statuses and empty verified-evidence arrays were preserved.
Local Node v24.22.1: existing release-policy suite **6/6 passed, zero skipped**; manifest checker **HOLD, 0/10, no validation errors**; `--require-ready` exited **1** as intended.
This validates the documentation/register change, not the application's Node 22 runtime or an independent release signature.

## AI Examiner source delta review — no tests rerun

Repository baseline: `50dfdeb4f99c5cdbaf1d5a9502c709fbbf2798f6` (main resolved during this review).
V5 source: `f736e64b0e1b332aabf20557025f10b3b602b97b`.
The GitHub comparison returned 270 changed files, 537 commits ahead and zero behind; this is a repository comparison, not proof of which V4 image is deployed. Directly compared both revisions of the AI worker and API route.

| Material V5 change | Source inspection | Existing acceptance evidence |
| --- | --- | --- |
| Entitlement checks | AI route adds ai_examiner to existing examinations gate; worker checks entitlement before provider invocation/reservation | CI cases 495–496: inherited examinations entitlement and parent denial; source inspection establishes worker call ordering |
| Optional metering | Exact tenant allowlist; reservation precedes provider call; prior reserved/settled evaluation blocks another call | CI 475–476: exact allowlist and settlement policy; integration case 12 verifies tenant-bound reservation, replay, concurrent capacity and exactly-once ledger behavior |
| Persisted-result settlement | Credit settlement follows result persistence; settlement exception retains result and reconciliation state | Worker source ordering inspected; policy case 476 verifies decision rule. No full worker-to-real-provider failure-path execution is claimed |
| Ambiguous failure | Reserved credits remain for reconciliation; no automatic refund inferred from timeout/failure | CI 472–474: valid persisted outcome, finance/foreign/incomplete denial, unknown provider state cannot auto-release |
| Manual reconciliation | Platform-only route, persisted provider proof and audit required | CI 954–955 passed; reservation integration case 12 rejects manual commit when persisted evidence is absent |

Evidence: [existing exact-source CI job 123447963320](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40873986354/job/123447963320). Relevant positive case lines are at 12:32:43 UTC, 12:33:02 UTC and 12:33:24 UTC on 29 October. These cases have passing lines without skip markers. Overall API suite in those logs: **1,173 tests; 1,172 passed; 0 failed; 1 skipped**. Do not describe the entire suite as zero-skipped.

The reviewed worker diff leaves the existing provider evaluation/scoring, second-pass, teacher-review persistence and checked-copy sequence in place around the added commercial controls. This limited observation does not certify all dependencies or provider behavior.

### Narrow remaining AI acceptance

1. Reuse prior V4 functional provider/grading evidence with its original source/date attribution; do not relabel it as V5 execution.
2. Retrieve existing V5 provider evidence, if any, for the changed entitlement and configured metering path. Current staging allowlist state was not inspected in this session.
3. If metering is in launch scope, the accountable provider/finance reviewer must map actual evaluation result and credit state for success and ambiguous failure/settlement. Existing policy/service tests do not by themselves prove the complete worker/cloud sequence. Only an uncovered material path warrants a new targeted test.
4. If metering is excluded, record that approved scope and prove the configuration exclusion through existing deployment evidence where available. Do not activate it to manufacture acceptance.
5. Keep Gate 5 PENDING until attributed review is supplied. This source review is completed; provider acceptance is not.

### Additional payment evidence located in the same existing CI log

- Integration case 18: signed payment failures idempotent, paid-state safe and isolated.
- Integration case 21: processed partial refund suspends paid modules/AI credits with durable replay protection.
- Integration case 22: renewal provenance uses paid invoices, tenant ownership, newest term and hold state.
- Policy cases 518–519 and 522: no overlapping paid terms, expired terms require fresh signed quote, latest tenant contract provenance.

These close previously unmapped automated failure/renewal coverage. They remain synthetic/disposable-DB evidence and do not establish real provider dispute/renewal acceptance.

**Execution record for this review:** repository/source comparisons and reads of already completed logs only; no test reruns, workflow dispatches, provider calls, server changes or release-state changes.
