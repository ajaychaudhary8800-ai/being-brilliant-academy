# Adhyay SchoolOS V5 — RC0 Preflight Candidate (HOLD)

**19 October 2026. NOT A GO decision.**

## Immutable application source snapshot

- Application source commit pinned for functional testing: `6e3cbc9e9227601e38adfd420d53491a7c9d9575`.
- V4 frozen `main` comparison baseline: `50dfdeb4f99c5cdbaf1d5a9502c709fbbf2798f6` (GitHub compare 19 Oct 2026).
- Comparison: **270 commits ahead, 0 behind, 153 changed files**. This comparison proves only Git ancestry, not that all features have been accepted.
- RC0 validation branch has only *release metadata* updates after the pinned application source commit, not production modifications.
- Linear development lineage covers V5 #179, #180, #182–193, #195–199, #203–204, #206–209. Parent-child module controls from parallel Draft #181 were integrated in #209.
- Parallel Draft #194 and independent coaching-mode scope were **not** merged. Renewal recovery classification and coaching-specific entitlements require explicit compatibility decisions prior to any actual release.

## Actions needed before marking RC1

1. Review integrated application code and the 153-file V4→V5 diff. Resolve any changed product spec or import/library namespace mismatches.
2. Execute `pnpm v5:release:test`, `pnpm v5:release:check`, V5 full CI, complete isolated PostgreSQL migrations, TypeScript and Docker build on **this candidate**, then preserve CI run IDs and artifact digests.
3. Restore a validated V4 production-like backup **only to isolated staging**. Re-run migrations and separately verify external legal/commercial document encryption, tenant counts, payment/ledger invariants and DR restore.
4. Test full signed quote, checkout, renewal, dispute, captured payment and CRM onboarding against Razorpay TEST; do not activate any paid V5 billing flags on production.
5. Test LiveKit signed-room events, zero usage proof and provider cutoff using an actual staging room, including reconnect, missing/out-of-order events and concurrent rooms. Test AI Examiner metering with the provider timeout and duplicate billing.
6. Validate independent ERP/LMS school roles, client feature controls, data privacy, resilience, browser/mobile UX, and the real institutional pilot.
7. Obtain finance/legal signoff and independent business owner production approval.

## Release approval protocol

`config/schoolos-v5-release-gates.json` remains `declaredStatus=HOLD`, with all ten independent final-release gates PENDING. `releaseCandidateSha` is pinned to RC0 source. `pnpm v5:release:require-ready` must fail until the required evidence JSON files have been independently validated and all gates are VERIFIED. RC0 is **not** authorization to merge Draft PRs to `main`, apply a production database migration, enable billable AI/video features, or change a Coolify production target.

The last feature-engineering progress estimate was 88%; this release-candidate preparation improves integration traceability but does not justify stating 100% commercial readiness.
