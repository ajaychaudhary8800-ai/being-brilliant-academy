# SchoolOS V5 Stage 7B — Finance-controlled add-on rate catalogue

Business owner-approved base annual plans are separate from **add-on prices**, for which no approved rates have been provided.

A SchoolOS add-on price is entered as a DRAFT by a platform super administrator. It must be independently APPROVED by a *different* platform super administrator with a finance/commercial approval reference before it becomes quote-eligible. Historical versions are retained, never rewritten on approval.

Supported add-on identifiers: modules from the Stage 1 catalogue, capacity (students, users, branches, storage_gb), AI credits, video minutes, and implementation (onboarding, migration, training). CUSTOM_WORK is **not** eligible for automated priced checkout. INR unit prices are in paise; the SKU and quote GST basis must match exactly.

New quotations with add-ons require an approved, in-force unique SKU whose effective window covers the proposed quote validity. Exact label/price/version/approval evidence is snapshotted onto the draft alongside existing plan pricing; the quote remains internally reviewed and contracted only after the existing maker-checker and signed-Order-Form process.

This stage does **not** create payment orders for custom add-on quotes, activate individual feature licenses, or connect AI/video workers. The Stage 6 payment path continues to reject any quote containing add-ons, discounts or unsupported metering. Do not market this as a completed usage-based billing implementation.

Production Version 4 is unchanged. Stage 7C must implement verified checkout and invoice line allocations tied to quote snapshots, captured-payment activation, grant idempotency, refunds/reversals and independent test gateway QA before commercial launch.
