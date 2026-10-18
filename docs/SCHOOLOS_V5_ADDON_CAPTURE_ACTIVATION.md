# SchoolOS V5 Stage 7C — Captured-payment Add-on Activation

This **Draft implementation** extends the institution-owned subscription gateway, not the student fee merchant gateway.

## Verified payment path

1. Platform Super Admin issues an internally approved quote with a finance-approved SKU snapshot and independently verified signed Order Form. Each add-on uses a versioned INR paise price from Stage 7B.
2. Customer tenant Super Admin checks out the **annual base plan plus individually priced supported add-ons**. Stage 6's existing base-only path remains unchanged.
3. The API checks exact plan and line-item pricing, quotation and document identity, expiry, tenant ownership, rate history, GST, totals, capacity and duplicate payment attempts. Invoice metadata includes an immutable add-on-line snapshot.
4. Razorpay order capture is processed exclusively by the pre-existing HMAC-verified webhook. In the **same PostgreSQL transaction** as marking the invoice and quotation PAID, paid module/capacity licenses and AI/video credit grants are inserted, with invoice-linked idempotency. A failure rolls back activation.
5. Effective purchased modules and additional student/user/branch capacity are read from **active, PAID invoice-backed licenses**. Plan cancellation/expiry removes supplemental access. Paid credit grants use the per-tenant ledger from Stage 7A.

## Deliberately excluded

- Discounts, custom work, storage capacity, pilot fees and implementation services still fail checkout validation.
- API does **not** expose user-writable license/credit minting endpoints.
- AI Examiner inference and LiveKit video usage are **not connected** to credit consumption. Having credits does not imply actual provider billing enforcement.
- Refund, chargeback, reconciliation of captured but invalid orders, proration, repeat purchases during overlapping metered periods, and expired-credit recovery still require separate implementation and staging testing.
- There are no approved commercial SKU prices seeded. Payment flow cannot go live until base plans and add-on rate catalogue are reconciled and signed legal terms verified.
- No production deployment, billing key changes, main merge or actual Razorpay payment was performed in development.

## Release gates

Add independently verified Razorpay TEST-mode E2E with webhook replay, refund/chargeback and failed settlement recovery; concurrency and real Postgres trigger isolation; signed PDF amount signoff; finance authorization and approved SKU rollout; migration/backup/restore rehearsal; security review and QA of tenant limits and AI/video integration. Keep V4 frozen until explicitly approved.
