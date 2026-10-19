# SchoolOS 5.0 Stage 7D3 — Paid-term and Credit Expiry Guardrails

## Implemented in Draft

- Before creating a **new** signed SchoolOS annual purchase invoice, the tenant's other PAID SaaS invoices are checked for time-overlapping subscription periods under the signed-quote checkout lock. Early renewal, proration and mid-period custom-plan upgrades are **not** currently supported. Existing open same-quote provider orders retain the Stage 7C reconciliation path.
- When receiving a separately verified signed SaaS payment capture, the platform **again** checks whether a previous PAID invoice already covers the same period. Captured funds are not blindly applied to an overlapping subscription; a finance reconciliation exception must be investigated. No provider refund is initiated automatically.
- A read-only, tenant-authorized renewal readiness endpoint reports the current paid term, remaining days, need for a new signed quote, cancellation schedule, and each prepaid usage bucket's recorded remaining credits versus **currently usable** credits.
- Expired credits remain in the immutable ledger for reconciliation but are presented as **0 usable** after their purchased period. Purchased credits are not transferred into a new annual term. A scheduled cancellation **does not** prematurely invalidate current paid-term access.
- Refund/dispute-held periods also return **0 usable credits** in the renewal read view. Existing usage-service debit still checks the paid-bucket validity period and risk holds separately.
- Billing recovery permits a tenant super admin to obtain this read-only report even if the subscription has expired. Platform Super Admin has a tenant-specific read-only view.

## Important limitations and requirements

No cron-driven auto-renewal, advance invoice issuance, automatic payment capture, midterm add-on upsell, proration, reactivation grace period, GST credit notes, refund workflows, or renewal carryover is activated. Standard legacy SaaS checkout and client data remain unchanged.

The signed-quote checkout is deliberately blocked if a paid SaaS term overlaps. This is a **safety guardrail, not completed subscription renewal commerce**. Real renewal requires independent rate-card approval, new signed document, verified paid invoice, future-term alignment and TEST-mode provider scenario validation.

No Razorpay live payments were initiated, no production databases migrated, and V4 main remains untouched.
