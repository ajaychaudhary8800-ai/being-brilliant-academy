# SchoolOS Version 5.0 — Stage 7E3: AI Credit Reconciliation

## Delivered — Draft PR

An authorized platform finance operator can inspect outstanding prepaid AI reservations without initiating provider work, charging a payment card, or releasing a reserved credit.

**Read-only queue:** `GET /api/v1/platform/schoolos/ai-reconciliation/:organizationId?limit=50`

**Evidence-backed settlement:** `POST /api/v1/platform/schoolos/ai-reconciliation/:organizationId/:evaluationId/commit`

Body: `{"evidenceReference":"...", "reviewComment":"..."}`. The platform SUPER_ADMIN must be operating from an `org_default` home organization. Tenant SUPER_ADMIN, teacher and unauthenticated users are denied. The action remains DISABLED unless that exact customer organization is explicitly allowlisted in `SCHOOLOS_AI_METERING_TENANT_IDS`. No wildcard support.

## Reconciliation rules

- Pending balances are tracked by the original institution, usage metric and evaluation ID.
- Only a matching tenant-owned AIExaminerEvaluation with **REVIEW_REQUIRED** or **APPROVED**, a valid completed timestamp, an identified AI provider and model, at least one persisted question row, and no error code is classified as VERIFIED_SUCCESS.
- Missing/cross-tenant results, FAILED/CANCELLED evaluations, unfinished jobs and active finance risk holds cannot be committed via the manual endpoint.
- Each manual settlement is atomic with the original ledger's reservation-to-COMMITTED transition and CONSUME event insertion. The platform reviewer, supporting reference and justification are audit logged.
- Repeated settlement never consumes more than one prepaid unit.
- An ambiguous/failed evaluation does NOT imply a failed provider call or refundable credit. Automatic release and automatic reconciliation are always disabled. Releasing credits continues to require separately designed proof of non-billable provider outcome and independent approval.

## Operational limitations

The queue is bounded to the 100 oldest pending reservations for one organization; it exposes a total count and truncation flag. There is no bulk settlement, recursive auto-retry or cross-tenant search. No provider invoice, external payment order or API key is accessed.

The AI Examiner billable-unit pricing remains **proposed**. No environment variable has been enabled, no customer charged and no V4 production code or database changed.

## Next

- Implement proof-backed, two-person review for releasing demonstrably non-billable provider attempts; investigate timeout/unknown states externally before resolution.
- Run Razorpay TEST and AI provider failure acceptance for an isolated paid test tenant.
- Stage 7F: verify video call attendance/LiveKit duration events and billable video-minute reconciliation before live activation.
