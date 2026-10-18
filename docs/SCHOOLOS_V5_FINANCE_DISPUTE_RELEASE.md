# SchoolOS 5.0 Stage 7D2 — Audited Won-Dispute Release

## Added

- Razorpay `payment.dispute.won` can be **recorded** from a properly HMAC-verified webhook; unlike `refund.processed` or `payment.dispute.lost`, it is not evidence of a new monetary loss.
- A signed won notice must reference a previously recorded `payment.dispute.created` from the **same captured SaaS payment**. Original order IDs that are null in provider dispute payloads are independently resolved from the captured payment record. Unrelated student tuition flows are never routed into SchoolOS finance cases.
- Every distinct signed provider adjustment increments a risk-hold revision. Existing proposals become stale when late adjustments arrive.
- Platform Super Admin may propose a finance release with a specific external evidence reference and reason. A **different** authenticated platform Super Admin must review and approve or reject. All decisions and provider notifications are audited.
- Only if **all disputes are won**, with no processed refunds and no lost or unresolved disputes, may an independently approved review resolve the hold. Existing paid module/capacity licensing is restored **only within the originally purchased valid term**. No credits are minted or reissued.
- Any later signed refund or dispute reopens a RESOLVED hold automatically. Advisory locks serialize inbound provider changes, finance review decisions and metered debit operations.
- PostgreSQL constraints preserve review provenance and deny self-review at the database layer.

## Critical non-goals and remaining commercial blockers

This PR does **not** initiate refunds, generate GST credit notes, reverse consumption, reimburse unused credits, write off disputes, settle provider accounts or extend subscription expiry. Processed refunds and lost disputes cannot be manually overridden to clear a hold.

Provider reconciliation **beyond the signed webhook** (Razorpay TEST integration, time-of-delivery ordering, provider-initiated refunds, payment status verification on retry, sandbox renewal and chargeback evidence, settlement bank proof and independent signed finance references) remains required prior to any live financial release feature.

AI Examiner and LiveKit are still not wired to SchoolOS credit debits. Finance event coverage does not constitute end-to-end AI/video metering.

All changes are restricted to isolated V5 Draft PRs. Do not merge to V4 production or run DB migrations on shared staging without explicit independent authorization.
