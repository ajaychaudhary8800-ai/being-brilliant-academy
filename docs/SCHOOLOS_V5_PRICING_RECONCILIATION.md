# SchoolOS V5 — Commercial Pricing Reconciliation

Reference: SCHOOLOS-LAUNCH-2027-INDIA-V1 (business approval 18 October 2026).
Pricing is an **indicative launch reference, not an automatic amendment** to production plans or customer contracts.

| Tier | Proposed annual ex GST | Proposed onboarding ex GST |
| --- | ---: | ---: |
| Essentials | ₹49,900 | ₹9,999 |
| Growth | ₹99,900 | ₹14,999 |
| Professional | ₹1,49,990 | ₹24,999 |
| Enterprise | Custom | Custom |

Separate suggested pilot: 60 days, ₹14,999 + applicable GST.

## Gap and safety controls

The existing September 2026 live plan records are older than this reference, particularly Essentials and Growth. The new rate reference is intentionally **comparison-only**; no migration or seed updates live prices. Plan alignment checks compare annual paise, INR, GST and active status; Enterprise is expressly custom-quoted.

The API returns review readiness for internally approved client quotes. It never activates access; external issuance, signed Order Forms, verified payments, upgraded limits and quote-specific add-ons remain separate work.

## API

- `GET /api/v1/platform/schoolos/pricing/reconciliation`: platform-super-admin-only current price gap report.
- `GET /api/v1/platform/schoolos/pricing/quotes/:quoteId/readiness`: internal quote conditions and block reasons.

UI: `/admin/schoolos-pricing`.

## Next gating work

1. Commercial approval and legal sign-off for rate updates and add-on prices.
2. Versioned quote issuance and signed customer acceptance evidence.
3. Checkout invoice from immutable approved amount tied to correct tenant; webhook-verified settlement before granting entitlements or limits.
4. Independent PostgreSQL and multi-tenant negative tests; staging dry run.
