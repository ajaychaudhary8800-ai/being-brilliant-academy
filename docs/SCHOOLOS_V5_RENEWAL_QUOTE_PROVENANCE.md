# SchoolOS V5 — Stage 7D3B: Auditable Renewal Quotations

- Platform Super Admin can tag a **new** SchoolOS quote with `renewalSourceInvoiceId`. Quote creation still uses independently approved current annual price and manually specified add-on SKU lines; old paid add-ons and credits are **never copied**.
- The source must be this tenant's latest **PAID**, signed SchoolOS invoice, and must not have an unresolved payment-risk hold. A different tenant or older invoice is not valid.
- Renewal provenance (source invoice and original paid period end) is saved in the immutable quotation pricing snapshot, quotation revision audit, and customer invoice (through its quoted snapshot reference).
- Existing maker-checker quote approval, independent signed Order Form verification, and payment-only activation rules remain mandatory. Stage 7D3A prevents term overlap.
- Before renewal invoice checkout **and again during signed Razorpay capture**, the original invoice, tenant, last-paid status, finance hold, and frozen prior period end are revalidated. A stale source or capture requiring reconciliation **fails closed**.
- A renewal can be quoted in advance but cannot be paid/activated through contracted checkout until the previous purchased term ends. This is deliberate while future-dated activation and prorations lack dedicated controls.
- Renewal beyond the expiry date uses a new one-year term starting at successful checkout. No grace-period access, expired credit rollover, automatic recurring charging, or refund adjustment is introduced by this PR.
- No production V4 change, migrations, SaaS plan price overwrite, webhooks, server operations, or charge is performed here.

Remaining Stage 7D3 items: signed contractual future-term activation design, explicit grace-period policy, payment-failure recovery and end-to-end Razorpay TEST settlement including renewals after financial dispute resolution.
