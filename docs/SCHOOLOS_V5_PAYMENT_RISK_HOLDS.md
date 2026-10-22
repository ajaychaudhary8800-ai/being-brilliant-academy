# SchoolOS V5 Stage 7D1 — Refund and Dispute Financial Risk Holds

## Intent
A captured SaaS payment is not irrevocable. Razorpay can report an independently signed processed refund, a newly raised payment dispute, or a lost dispute. These events must not leave purchased add-ons usable indefinitely.

### Implemented, not production-deployed
1. The **existing Razorpay webhook** checks the exact raw-body HMAC signature before any risk event is parsed. Only `refund.processed`, `payment.dispute.created` and `payment.dispute.lost` are eligible. `refund.created` and unverified client messages do **not** represent successful reversals.
2. The provider payment ID, order ID, amount, currency and independently recorded captured SaaS payment are cross-checked. Events without a SchoolOS signed-quote SaaS invoice are ignored by this handler, preserving the separate institution-owned tuition merchant flow.
3. An immutable per-event adjustment and **ACTIVE per-invoice risk hold** are recorded transactionally, including for *partial* refunds and newly created disputes. Idempotency uses refund/dispute ID and event type. Multiple processed partial refunds cannot exceed the captured amount.
4. Purchased **module/capacity add-ons from an affected invoice are excluded** from effective tenant licensing while held. All tenant AI/video consumption is conservatively suspended during any active financial hold until reviewed. Current consumed-unit and grant records are *preserved*, not reversed by arithmetic deletion.
5. The database prevents fresh credit or license insertion from held paid invoices even via direct SQL. The customer read-only usage response indicates financial review is required.

### Deliberate safety choices
- No refund initiation, provider API refund issuance, invoice mutation from `PAID` to `VOID`, currency/tax credit note issuance, or plan downgrade is performed by this stage. **Base subscription stays unchanged** pending finance reconciliation; this is intentional to prevent corrupting other paid periods.
- A risk hold cannot currently be lifted by customer or platform UI, including on `payment.dispute.won`. Reinstating paid units must require a future audited and separately authorized finance-resolution workflow after refund/chargeback investigation.
- AI Examiner and LiveKit are not yet connected to metered debits; blocking the service-level debit does not itself block existing unmanaged provider calls.
- No renewal/proration workflow, full credit expiry/reversal, or refund amount attribution by individual custom SKU. These remain Stage 7D release blockers.
- Past usage events must not be destroyed or regranted on recovery. Finance must record any credit-note adjustments and ensure a verified outcome before entitlement restoration.

### Required release tests
Razorpay TEST event signatures, replay and out-of-order delivery, partial+multiple refunds, dispute created/lost/won reconciliation, tenant isolation and subscription/credit persistence, refund after renewal, source-order mapping, webhook failure/retry, and staged backup/migration/rollback tests.

No V4 production changes, no main branch merges, and no actual Razorpay calls are made in this PR.
