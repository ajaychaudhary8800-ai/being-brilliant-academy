# SchoolOS 5.0 — Stage 6: Signed Base-Plan Checkout & Verified Settlement

This stage builds on the frozen V4 verified Razorpay SaaS payment webhook, while leaving institution fee collection separate.

## Scope / safety

- Tenant SUPER_ADMIN can request checkout only for a linked `CONTRACTED` quotation and independently verified signed Order Form.
- Plan must be active, INR, annual and reconciled with the approved launch reference.
- **Only the undiscounted, no-add-on base plan** supports automated checkout at this stage. Custom modules, discounts, credits, trials, AI, video, onboarding and capacity top-ups are explicitly excluded, rather than being silently granted.
- A unique `SchoolOSQuotation` → `SaaSInvoice` link prevents duplicate quote invoices. Razorpay order is created only after a server-generated, exact-amount invoice; idempotency returns the existing open provider order.
- Webhook signature verification remains in the existing `payments.ts` handler; provider-verified captured amount/currency/order ID are checked by existing settlement logic.
- Only **verified captured payment** can set quote `PAID`, change the tenant's SaaS plan to ACTIVE, and switch on purchased base-plan module limits. Prepayment checkout does not activate the quoted upgrade.
- Bound signed evidence cannot be archived or reverified without a recovery process. No production deploy and no payment attempt occurs during development.
- Customer-facing contract checkout UI and signed electronic acceptance are follow-on work. Staging must use Razorpay TEST credentials only.

## Outstanding concerns and gates

- Manual finance review of September versus October published prices. Until aligned, the checkout policy rejects payments.
- Webhook recovery/reconciliation of any orphan provider orders or unmatched captures; finance must not ignore captured-but-unreconciled payments.
- E2E tests for concurrent quote checkout, payment retry, unauthorized tenant, forged webhook and reseller/multi-tenant access.
- Contract-specific add-on entitlements and quotas require separate versioned entitlement ledger and metering before custom quotes become self-service payable.
- Independent PostgreSQL upgrade/rollback and full staging QA are required before approval.
