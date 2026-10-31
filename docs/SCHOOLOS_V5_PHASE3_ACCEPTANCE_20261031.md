# Phase 3 payment and finance acceptance — 31 October 2026

Status: **TECHNICAL WORK IN PROGRESS / ACCEPTANCE BLOCKED / COMMERCIAL HOLD**.
Reviewed baseline: `b54dca5ae36a948f83012faa4a37354198fba083` (cumulative V5 PR #262).
Coordination: Issue #258. Security restriction: #293 remains open; no shared staging access, deployment, credential use, real-money transaction or provider TEST transaction was performed.

## Findings and evidence reuse

| Work package | Weight | Existing implementation/evidence | Remaining acceptance or implementation |
| --- | ---: | --- | --- |
| TEST order/capture | 0.70 | Signed quote checkout, tenant mapping, order reuse, amount checks, atomic payment/quote/subscription capture; prior synthetic HTTP evidence in provider evidence map | Genuine TEST order/payment-to-contract/invoice evidence. New defect: capture did not reject DRAFT/VOID invoices; this branch adds a controlled 409 and transaction non-mutation regression. |
| Webhook security | 0.50 | Raw-buffer HMAC before parsing; constant-time comparison; order/advisory locks, replay conflict checks, late-failure handling and tenant boundaries | Execute changed capture regression and retain actual TEST delivery evidence. Do not infer provider acceptance from locally signed HMACs. |
| Subscriptions | 0.50 | Signed annual activation, expiry/cancellation, failure retry, renewal source/overlap guards and paid entitlement checks | Annual renewal requires a fresh signed quote after the current paid term. Mid-term upgrades/downgrades, proration, early renewal and automatic renewal are explicitly unsupported. Finance/product must define those terms or explicitly accept a bounded annual-manual-renewal launch scope; no new prices or implied prorations implemented. |
| Refunds/disputes | 0.50 | Provider-linked partial/full refund adjustments, cumulative refund ceiling, replay guard, add-on risk holds and independent finance release for won disputes | Existing service receives refunds; it does not initiate provider refunds, issue credit notes or reimburse unused credits. Actual TEST refund/dispute proof and accountable manual refund operating procedure or separately approved implementation remain outstanding. |
| Invoices/accounting | 0.50 | Tenant invoice reads/PDF, stored paise totals, source pricebook, immutable payment adjustments | Provider-to-ledger reconciliation, approved invoice/tax treatment and refund credit-note handling. Invoice number is timestamp plus UUID suffix; statutory numbering suitability is not established by this review. No tax opinion or compliance certification given. |
| Finance acceptance | 0.30 | Owner-reported Madhuri approval acknowledged by #258 and release manifest | Original attributable dated decision, applicable scope/exceptions and protected actual TEST artifact references remain absent from reviewed sources. Do not request the same policy approval again or fabricate a signature. |

Prior executed evidence: `docs/SCHOOLOS_V5_PROVIDER_EVIDENCE_MAP_20261029.md`, including exact-source HTTP capture/replay/failed-payment/refund tests and renewal provenance coverage. Reuse only for unchanged paths. A new regression against changed settlement logic is required.

Pricebook unchanged: `SCHOOLOS-LAUNCH-2027-INDIA-V1`; Essentials INR 49,900, Growth INR 99,900, Professional INR 149,990 annual base; Enterprise requires custom quotation. The configured 1800-bps tax reference is not a legal classification decision. Existing finance decision sheet predates the later owner approval report: the newer #258/manifest approval-intent record takes precedence; original acceptance evidence is still pending.

## Capture-state correction

The service previously treated any non-PAID invoice as eligible for capture if other checks passed. The new guard permits only OPEN/OVERDUE for new settlement, preserving the existing verified PAID replay branch. DRAFT/VOID returns `SCHOOLOS_CAPTURE_INVOICE_STATE_CONFLICT` before financial writes. The provider may already have captured funds: the 409 is a reconciliation signal, not a refund or denial that funds moved.

The existing Phase 3 signed HTTP/PostgreSQL scenario is extended to check both rejected states, unchanged invoice/quote/subscription and zero new capture/payment-event records; the subsequent concurrent positive settlement starts from OVERDUE. This changes payment-only test fixtures, not Phase 2 ERP/LMS fixtures. No schema migration, price change or shared CI workflow modification.

## Evidence required after security clearance

1. Phase 1 records #293 remediation and #292 rollback/provenance clearance; #258 records an authorized staging window before provider access or changes.
2. Retrieve the previously reported real TEST evidence first. Match protected contract reference, tenant, quote, invoice, provider TEST order/payment/refund identifiers, callback outcomes and ledger sums. Do not publish customer data, raw provider payloads or secrets.
3. Record retry/failure, duplicate/out-of-order, refund total and dispute disposition; explicitly mark unavailable provider scenarios as pending or formally scoped exceptions.
4. Record Madhuri's attributable decision against that evidence, including subscription scope and invoice/credit-note treatment. Existing approval intent is not re-requested.

No actual provider identifiers or signatures are present in this package. No live charge/refund is authorized. No release manifest status or candidate pin has changed.

## Planning record

No complete task is accepted solely from this source review or passing synthetic tests. Phase 3 accepted credit: **0.00 / 3.00 planning points (0%); outstanding 3.00 / 3.00 (100%)**. This is an acceptance-credit measure, not a claim that no code exists. Last #258 reconciled Phase 1/2 credits: 2.00/4.00 and 3.70/5.00; original provisional overall backlog **14.30 percentage points**, unchanged. New scope/security findings require a later forecast revision; 14.30 is not a measured launch-readiness percentage. Formal gates **0/10 VERIFIED**, commercial **HOLD**.
