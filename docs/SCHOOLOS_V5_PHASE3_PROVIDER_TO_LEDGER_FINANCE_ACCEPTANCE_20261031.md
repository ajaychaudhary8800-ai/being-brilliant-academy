# SchoolOS V5 — Phase 3 provider-to-ledger and finance acceptance
**Prepared:** 31 October 2026. **Branch:** Phase 3 draft PR #294. **Authority:** Release Board Issue #258.

**State:** INDEPENDENT CODE/DOCUMENTATION READY FOR REVIEW; EXTERNAL PROVIDER EVIDENCE AND FINANCE ACCEPTANCE NOT COMPLETE; COMMERCIAL GO = HOLD.

## Scope, evidence hierarchy, and safe handling
- Prefer reuse of previously passed immutable V4/unchanged V5 source evidence. Only add targeted tests for genuinely new code paths. Existing GitHub Actions workflows auto-trigger upon PR commits; an auto-run is not a newly requested manual live test.
- Highest confidence: genuine provider-origin Razorpay TEST dashboard/API records; corresponding signed delivery timestamps; independently checked internal invoice/payment/adjustment/audit; original protected finance signoff. Local synthetic HMAC + disposable PostgreSQL integration is useful development verification, **not** evidence of Razorpay-issued events or real bank settlement.
- Never expose provider keys, raw callback signatures, customer PII, payment tokens, merchant secrets, GST identifiers or privileged records in GitHub. Store originals only in the approved restricted vault. Publish redacted reference IDs, content digests and reviewer-verifiable results to the release board.
- Phase 1 P0 #281, #292, #293, approved staging window and rollback clearance must precede authenticated shared-staging activity. This package authorizes **no** provider call, credential access, staging write, real payment, deployment, or live V4 operation.

## A. Provider TEST-to-ledger acceptance checklist
All required provider-origin items below are **BLOCKED_BY_PHASE_1** until the staging access/safety window is cleared. Do not manufacture IDs, test transactions or signatures. Retrieve already-existing artifacts first.

| ID | Artifact and exact fields to corroborate | Validation rule | Status |
| --- | --- | --- | --- |
| F3-01 | Verified customer signed-order original, quoteNo, contractDocumentId, institution organization ID and rate-card snapshot | Identity + tenant match, signed reference, immutable quoted INR paise total, validity, independent checker | BLOCKED_BY_PHASE_1 |
| F3-02 | Original Razorpay **TEST** order ID, merchant TEST indicator, amount/currency, createdAt and receipt | Match quote and existing SaaSInvoice organizationId, checkoutKey, invoiceNo and providerOrderId without creating another order | BLOCKED_BY_PHASE_1 |
| F3-03 | Original Razorpay **TEST** captured providerPaymentId, amount/currency, orderId and timestamp | Exactly one captured payment for invoice; no DRAFT/VOID capture, future/expired term or overlapping PAID term | BLOCKED_BY_PHASE_1 |
| F3-04 | Razorpay-origin callback delivery/receipt, event type, original signature verified privately, event dedup key and response | Provider HMAC verified over original raw bytes; ID/amount/tenant ownership; duplicate valid replay no second debit/grant | BLOCKED_BY_PHASE_1 |
| F3-05 | Source-level invoice + quote + subscription and pre/post paid state extracts | PAID quote and invoice together, matching plan/term, one SaaSPayment, one processed event, approved feature enforcement, no cross-tenant mutation | BLOCKED_BY_PHASE_1 |
| F3-06 | Original **TEST** failed attempt/retry evidence, if provider supports | FAILED never marks invoice PAID; late failure does not downgrade PAID, mismatched attempts reject; unavailable real scenarios = documented EXCEPTION, never PASS | BLOCKED_BY_PHASE_1 |
| F3-07 | Original provider refund.processed and/or dispute notification, if supported | Must belong to captured payment and paid tenant invoice; aggregate refund <= capture, ledger adjustment once, hold ACTIVE; mismatched won amount must reject, release maker != checker | BLOCKED_BY_PHASE_1 |
| F3-08 | Independent platform reconciliation GET, immutable invoice/ledger snapshot and bounded row count | No foreign/duplicate/truncated records, valid dispute provenance; internal arithmetic may be consistent, providerSettlement and taxCompliance remain NOT_VERIFIED | BLOCKED_BY_PHASE_1 |
| F3-09 | Provider settlement statement and actual bank deposit mapping (if applicable) | Separate gross capture, provider fees, deductions, payouts and reversals; TEST mode itself **cannot** establish actual bank settlement | HUMAN_ACCEPTANCE_REQUIRED |
| F3-10 | Approved exceptions/limited commercial scope and finance reviewer signed record | Each unavailable scenario has reason, control, expiry, owner; no implied approval by silence | HUMAN_ACCEPTANCE_REQUIRED |

**Required chain:** approved signed contract -> quotation snapshot -> tenant -> SaaSInvoice -> Razorpay TEST order -> signed callback -> SaaSPayment -> SaaSWebhookEvent -> PaymentAdjustment/Hold if applicable -> accounting decision -> reviewer-approved evidence.

For each real artifact record only: private vault locator, SHA-256, acquisition timestamp and time zone, provider TEST/LIVE designation, reviewer and source system, redacted ID suffix, version, positive/negative verdict, and any discrepancy ID. The vault—not GitHub—owns the original IDs and signatures.

## B. Code-level disposition and unresolved customer operations
| Domain | Existing technical behavior | Human/provider gap |
| --- | --- | --- |
| Checkout | Signed verified quotation, annual price snapshot, tenant isolation, single open/overdue order and idempotent retry | Genuine provider TEST original order tied to a genuine approved signed document |
| Capture/webhook | Raw-body HMAC, constant-time compare, provider identity/amount checks, advisory locks, signature refusal and idempotent replays | Provider-origin TEST callbacks and independently reviewed provider transaction status |
| Subscription | Signed annual PAID activation, expiry and future-term veto, overlap prevention, manual signed renewal; platform bypass guards | Formal annual-only scope, renewal and cancellation notice policy; automatic renewal and proration are unsupported |
| Failures | Stored FAILED provider attempt, late-failure no downgrade, no unpaid grace or new entitlement | Real TEST failure origin if feasible and provider exception log |
| Refunds | Incoming processed-refund accounting, ceiling, maker-checker risk hold, no automatic unfreeze | Refund initiation is not implemented: approved customer-service manual refund pathway and test evidence required |
| Disputes | Raised/won source matching, mismatch deny, source provenance and contradictory-outcome finance-review flags | Real provider TEST dispute evidence or explicit accepted exclusion |
| Reconciliation | Read-only bounded internal PAID ledger sums and null totals on inconsistency | Independent provider settlement, bank, fee and statutory accounting reconciliation |

## C. Invoice, GST, credit notes and finance accounting decisions
Existing internal SaaS invoice/PDF is a **billing transaction record**, not certified as a statutory GST tax invoice. Do not represent the displayed 18% reference tax as a confirmed legal rate.

**Unchanged pricebook:** SCHOOLOS-LAUNCH-2027-INDIA-V1. Essentials INR 49,900/year; Growth INR 99,900/year; Professional INR 149,990/year; Enterprise only on separate bespoke signed approval. Configured 1800-bps GST illustration implies 58,882; 117,882; 176,988.20 INR inclusive if applicable. No new prices, discounts or retrospective quote changes.

| Acceptance item | Required accountable decision and evidence | Status |
| --- | --- | --- |
| GST classification | Service classification/SAC, appropriate GST rate, supply location, IGST versus CGST/SGST, place/time of supply, exemptions, reverse charge where relevant; applicable tax advice | HUMAN_ACCEPTANCE_REQUIRED |
| Supplier and purchaser details | Verified legal supplier name, GSTIN, addresses, buyer legal/billing identity/GSTIN where required; source controlled invoice data | HUMAN_ACCEPTANCE_REQUIRED |
| Tax invoice number/fields | Approved invoice series/chronology, date, description, taxable value, tax split, mandated declarations, e-invoicing applicability; existing UUID/timestamp numbering not deemed compliant by default | HUMAN_ACCEPTANCE_REQUIRED |
| Credit notes | Approved credit-note serial, original invoice/period/refund linkage, partial allocation (taxable value and tax), buyer notification and GST-return adjustments; **no auto-credit-note implementation currently** | HUMAN_ACCEPTANCE_REQUIRED |
| Settlement and fees | Gross capture, Razorpay fees/taxes on fees, payout batch, deposit amount/date, reversals and suspense account; gross minus refund != bank settlement | HUMAN_ACCEPTANCE_REQUIRED |
| Refund initiation | Named authorizer, eligibility window, dispute/refund review workflow, evidence preservation, payout timing and customer communication; no unapproved automatic provider refund | HUMAN_ACCEPTANCE_REQUIRED |
| Renewal and cancellation | Annual-only signed renewal after expiry, cancellation at period end, no proration/automatic renewal/unused credits rollover; exception and customer terms signed | HUMAN_ACCEPTANCE_REQUIRED |
| Onboarding and pilots | Standard remote onboarding vs separately charged work, contract SOW, exclusion of unsupported 60-day commercial pilot from annual auto checkout | HUMAN_ACCEPTANCE_REQUIRED |

Preserve all original invoice and payment records. Do not delete/rewrite payment evidence to make accounting figures match, generate statutory documents without approved fields, or claim GST compliance from a formatted PDF. If compliance cannot be determined, carry it as a gated exception and do not launch statutory claims.

## D. Human finance decision record — uncompleted
- Reviewer: Madhuri Verma (designated). Owner approval intent is already reported; an original dated, attributable acceptance decision is **not yet verified**.
- Evidence reference (private vault): NOT PROVIDED.
- Environment and TEST merchant mode: NOT VERIFIED.
- Original quote, provider order, capture, refund, disputed events and ledger hash bundle: NOT PROVIDED.
- Annual-manual subscription and cancellation scope: HUMAN_ACCEPTANCE_REQUIRED.
- GST classification/invoice/credit-note accounting: HUMAN_ACCEPTANCE_REQUIRED.
- Provider fee/payout reconciliation and refund operating procedure: HUMAN_ACCEPTANCE_REQUIRED.
- Maker-checker independence/approved exception list: HUMAN_ACCEPTANCE_REQUIRED.
- Explicit decision: NOT YET REVIEWED (do not invent signature or mark APPROVED).
- Dated signed reviewer artifact: NOT PROVIDED.

## E. Release accounting and next action
- **BLOCKED_BY_PHASE_1:** genuine V5 provider TEST-to-ledger acceptance on controlled staging and final security/compatible rollback clearance (#281/#292/#293).
- **HUMAN_ACCEPTANCE_REQUIRED:** original dated attributable reviewer signoff, refund initiation/credit-note/GST/renewal and scope decisions.
- **Independent work permitted:** source-level correction and targeted isolated synthetic/mock-provider regression; controlled documentation and evidence retrieval; no new V4 or unchanged V5 manual retests.
- **Release verdict:** COMMERCIAL HOLD; Phase 3 formal accepted **0.00 / 3.00 planning points** (remaining 3.00, 100% formal acceptance), previous provisional overall backlog **14.30 percentage points** (estimate only), release gates **0/10 VERIFIED**. Do not silently award completion credit for documentation or synthetic tests.

**Linked sources:** Phase 3 Draft PR #294; Issue #258; docs/SCHOOLOS_V5_PROVIDER_EVIDENCE_MAP_20261029.md; docs/SCHOOLOS_V5_PHASE3_ACCEPTANCE_20261031.md; docs/SCHOOLOS_V5_FINANCE_LEGAL_DECISION_SHEET_20261029.md.