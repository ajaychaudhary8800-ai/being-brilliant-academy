# SchoolOS V5 — Quotation drafts, Stage 2

- Source branch extends Stage 1 feature licensing. Both remain unmerged Draft PRs.
- Calculates quote from existing `SaaSPlan` base prices/tax, with itemised module/capacity/AI/video/implementation/custom-work estimates, discount and GST.
- Integer paise arithmetic (BigInt internally) with strict bounds, validated inputs, no duplicate item keys.
- Additive Prisma models `SchoolOSQuotation` and `SchoolOSQuotationRevision`. Revisions are append-only; updates use optimistic concurrency.
- Price snapshots preserve plan code, original plan ID, last update, prices, tax and entitlements at quote time.
- Platform admin only: quote preview, create internal draft, browse, view and reprice internal draft; all writes audited.
- This phase **does not authorise** outward quote issue, commercial approval, PDF creation, order form conversion, payment or feature activation.
- New October 2026 rate card differs from live `docs/COMMERCIAL_PACKAGING_PRICING.md`; existing plan prices and contracts are untouched. Finance/commercial reconciliation is a hard prerequisite to external quotation.
- Known remaining: automated module price catalogue, usage and feature dependency checks, pdf with Unicode rupee, formal approval and payment-linked subscription activation, PostgreSQL/staging/tenant negative QA.
