# SchoolOS V5 — Verified Signed Order Form Binding (Stage 5)

Builds on Stage 4 pricing checks and the existing encrypted Commercial Document Vault. Internal approval is **not customer acceptance**. This stage links an independently verified signed order form to an approved, still-valid quotation and the exact tenant.

## Preconditions

- Only platform super admin can bind evidence.
- Quote is INTERNALLY_APPROVED with matching optimistic version, quote number, and INR paise total.
- Customer tenant exists and is active, annual plan is aligned to approved launch reference; no silent rate-card substitution.
- Encrypted Commercial Vault document has type `SIGNED_ORDER_FORM`, exact quote reference, independent uploader/verifier, VERIFIED status, signature timestamp within quote validity.
- Document's lead is marked won for that same organization. Nonmatching or archived evidence is rejected.
- Accepted document is unique per quotation and protected by a foreign key. Existing document archive route will reject archiving linked order-form evidence.
- Quote transitions to `CONTRACTED` with append-only revision and audit log.
- Contract status does **not** mean payment, invoice generation or activation.

## APIs

- POST `/platform/schoolos/contracts/quotes/:quoteId/bind` with expectedVersion, documentId, confirmedQuoteNo, confirmedTotalPaise, approvalNotes.
- GET `/platform/schoolos/contracts/quotes/:quoteId` to inspect linkage and current evidence status.

## Outstanding gates

Manual legal verification that the signed PDF amount, clauses, services and signatory authority match the order; independent QA for invoice settlement; contract-specific addon entitlements, limits and payment-verified subscription activation; production data migration and rollback.
