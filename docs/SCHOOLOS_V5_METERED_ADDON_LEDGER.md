# SchoolOS 5.0 — Stage 7A: Metered Add-on Ledger (development foundation)

## Scope

- Dedicated **AI credits** and **video minutes** ledgers, not student tuition or SaaS base-plan billing.
- Grants must ultimately originate from an independently verified captured **PAID** SaaS invoice tied to the same paid SchoolOS quotation, immutable rate snapshot, and approved priced AI/video line items.
- Idempotent consumption is a service-layer operation with an atomic conditional balance update, not a browser-writable credit adjustment.
- Additive database tables, integer unit accounting, per-tenant/metric deduplication, SQL constraints, and tenant-scoped read-only reporting.
- Existing V4 customer records and main branch remain unchanged; no paid integrations triggered.

## Critical limitations (cannot market as launched)

- The current PR #185 signed base-plan checkout **rejects** AI/video/add-on quotes. Therefore this stage's paid-grant mechanism is deliberately **not connected** to payment activation.
- Student/examiner inference, LiveKit/video delivery, recording, storage, streaming and background workers are **not yet wired** to the consumption function. This is not full AI/video cost enforcement.
- A reconciled, approved add-on price book and add-on-specific checkout/invoice path are still required before customers can buy these credits.
- Storage is intentionally excluded: gigabytes should be a capacity allocation, not treated as consumed credits.
- Requires independent concurrency, replay, refund/reversal, invoice settlement, and multi-tenant authorization QA before deployment.

## Commercial controls

No REST grant or debit endpoint exists. Neither customers nor platform staff can mint credits through a UI. Read-only balance APIs do not disclose other tenants. This avoids free access, inconsistent payments and pricing mismatches.
