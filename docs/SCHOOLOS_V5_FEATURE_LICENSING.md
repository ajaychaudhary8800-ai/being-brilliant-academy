# SchoolOS 5.0 — Stage 1: Client feature licensing (isolated development)

Source baseline: `main` commit `50dfdeb4f99c5cdbaf1d5a9502c709fbbf2798f6` (17 Oct 2026).
Version 4 production is **not** a V5 deployment target without explicit approval.

## Architecture and constraints

- Reuses `SaaSPlan.entitlements`, `Organization.settings.commercialEntitlements`, the existing platform super-admin authorization and `requireCommercialFeature()` middleware.
- New `featureOverrides` live in existing JSON settings; no migration or customer-data rewrite is needed in Stage 1.
- Only authenticated *platform* super admins may edit a tenant override. Tenant super admins cannot self-upgrade.
- Explicit disabled overrides deny even wildcard or legacy non-enforcement tenants. Positive overrides have precedence over plan entitlements but unpurchased grants **must** expire within 60 days. Expired grants automatically fall back to the underlying plan.
- Plan purchases and payment capture are not changed. Feature edits are recorded in the existing audit log, and edits for a single tenant are serialized in a database transaction.
- Disabled features retain their data. The tenant sidebar hides restricted modules, and already-protected API routes deny access.
- API: GET `/platform/schoolos/features`; GET `/platform/schoolos/organizations/:organizationId/features`; PATCH `/platform/schoolos/organizations/:organizationId/features/:feature`.
- UI: `/admin/schoolos-features`; client selector, 14 currently identified licensable feature keys, trial/disable/reset.
- Authorization: existing `homeOrganizationId === "org_default"` platform admin boundary and existing `AuthRequest` authentication.

## Important limitations — must not be presented as completed

- The 14 entries are the *currently supported plan entitlement keys*, not the complete requested V5 catalogue.
- Individual controls for AI Examiner vs examinations, live classes vs LMS, homework, student/parent portals, video, AI quotas, storage and core modules require separate route instrumentation.
- Limits beyond current branches/users/students need database-level guardrails and verified metering.
- Quotation pricing, PDF/order workflow, payment-linked feature activation and commercial approvals are next tasks.
- Subscription self-checkout still must verify payment before any paid upgrade.
- Add module dependency DAG only when independent sub-feature keys are enforced across every relevant API surface.
- Independently run PostgreSQL integration tests, multi-tenant negative tests, and staging acceptance before marking Stage 1 deployable.
- The old rate card in `docs/COMMERCIAL_PACKAGING_PRICING.md` (Growth ₹89,990 and Essentials ₹49,990) conflicts with the new proposal (Growth ₹99,900 and Essentials ₹49,900). Do **not** update existing plan prices, contracts, or subscriptions before finance/commercial reconciliation.

## Next V5 delivery

1. Commercially approved feature catalogue, per-client limits, usage credits and dependency checks.
2. Quotation calculation with INR paise, GST, discounts with approval and immutable rate-card version.
3. Versioned quotes and Order Forms, followed by **verified payment** activation only.
4. AI copilots, Examiner quality evaluation, student intelligence and integrations in isolated follow-on changes.
