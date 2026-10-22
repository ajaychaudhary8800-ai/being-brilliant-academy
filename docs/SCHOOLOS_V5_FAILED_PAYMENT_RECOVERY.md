# SchoolOS V5 Stage 7D3C — Failed Payment Recovery

## Verified development scope

- The Razorpay webhook verifies the raw-body HMAC before handling `payment.failed`. The original signed payload must contain `payment.entity.status=failed`.
- Only existing OPEN **signed SchoolOS quote** invoices are eligible. Payment identifier, Razorpay order, amount and INR currency are correlated to the original SaaS invoice; unrelated learner payments remain separate.
- Every verified failed attempt is stored as an idempotent `SaaSPayment` with status `FAILED`, redacted `SaaSWebhookEvent` and financial audit trail. Conflicting replay and cross-tenant payment ID reuse are denied.
- A delayed failed event cannot change a `PAID` invoice or a `CAPTURED` payment, because settlement and failure recording serialize against the same advisory lock.
- Read-only institution/platform renewal views expose a current pending signed invoice and failed-attempt count. If a previously created Razorpay order is within the invoice due time, the customer can reuse **that same existing order** through the already-existing contracted checkout.
- Expired, incomplete or held orders are marked **manual finance reconciliation**. No automatic replacement order, double charge, refund, subscription extension, add-on rollover, or extra metered usage grant.
- Existing finance dispute child event evidence is parsed from the original HMAC-verified event rather than a Zod projection which dropped nested refund/dispute fields.
- Explicit default unpaid grace period: **0 days**. This stage provides recovery reporting without authorizing unpaid continuation.
- PostgreSQL integration tests, policy unit tests and cross-route contract tests cover idempotency, replay conflict, invalid payment evidence, non-activation and safe retry rules.

## Remaining Stage 7D3 and commercial gates

- Independent Razorpay TEST-mode webhook end-to-end delivery including failed-then-captured attempts.
- Future-effective prepaid renewal scheduling and activation, verified provider capture reconciliation, and independently approved customer-specific nonzero grace policies if required.
- Manual finance-led replacement order workflow for expired or ambiguous orders; no automatic duplicate orders.
- Customer billing notifications and billing-support operational runbooks.
- These Draft changes are stacked on #192 and require complete PR CI, independent review and explicit deployment approval.

No V4 production change, migration, merge, deployment, live charge or external paid-service configuration.
