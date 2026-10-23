# SchoolOS V5 — Step 75 integrated release-candidate audit (2026-10-23)

> **DRAFT / HOLD — not a production release certificate.** This report captures observed staging checks and GitHub evidence; it does not convert any of the ten independent commercial-release gates to VERIFIED.

## Scope and candidate provenance

- Product: Adhyay SchoolOS V5; repository: `ajaychaudhary8800-ai/being-brilliant-academy`.
- V4 production remains on `main` and frozen; V5 isolation target is `https://v5-staging.beingbrilliantedu.com` / database `schoolos_v5_staging`.
- Pinned **reviewed application source**: `18b9f15c446890f5749944dd66f1fb6d482c2b83` (Draft PR #232). This Step 75 branch only adds documentation and HOLD-manifest metadata after that application commit; its later commit SHA must not be mistaken for a deployed container digest.
- Stacked review: Draft PR #230 (`release/schoolos-v5-integrated-review-20261022`, based on `main`) → Draft PR #231 (API-only Razorpay secret isolation) → Draft PR #232 (contract-only billing) → **this Draft QA/report PR**. None is merged or authorized for production.
- GitHub comparison `main...PR232`: ahead **443** commits, behind **0**, approximately **231 changed files**; `PR230...PR232`: ahead **20** commits, behind **0**, **9 changed files**. These describe the connector's comparison at audit time, not a completed dependency review.
- PR #232: CI run **39841427564 SUCCESS** (verify and containers); external-staging QA, isolated sandbox, and V4-upgrade rehearsal **SKIPPED** due to branch-name eligibility conditions, **not passing evidence**.
- **Pin limitation:** Operator verified that the deployed `saas-commercial` API route contains the PR232 protections, but the exact Coolify image digest/source commit and all runtime services have **not yet been independently attested**. Do not claim complete byte-for-byte candidate deployment provenance.

## Owner-operated isolated staging acceptance reported on 2026-10-23

The following are **operator-supplied test outputs**, not independently witnessed by the GitHub CI runner. Preserve their status as partial evidence until signed independent acceptance.

| Area | Observed result | Remaining proof |
| --- | --- | --- |
| Public staging health | `/`, `/api/health/ready`, `/api/health/operational` responded HTTP 200 | Pin digests; sustained alerts, worker/provider health |
| Staging isolation | `DATABASE_URL` path matched `/schoolos_v5_staging`; Razorpay mode `test` | Cross-service secret/volume review and live load |
| Legacy unsigned checkout | Correct tenant POST `/api/v1/organization/subscription/checkout` returned 409 `SCHOOLOS_SIGNED_QUOTE_REQUIRED`; existing invoice IDs unchanged | Replay/concurrency audit |
| Cross-tenant access | QA School principal attempting checkout of QA Coaching quote received 404 `SCHOOLOS_QUOTE_NOT_FOUND`; invoices unchanged | Broader tenant IDOR and authorization suite |
| Quote preview and draft | Professional ANNUAL base ₹149,990 + GST ₹26,998.20 = ₹176,988.20; quote `SO5-20261023-910D6E54`, ID `cmvkifdf5005xry0743jgg1g9` | Official pricebook approvals for other plans |
| Internal approval | Self-approval rejected; another platform SUPER_ADMIN account advanced quote to `INTERNALLY_APPROVED`, version 3 | Real-world independent human reviewer acceptance |
| CRM linkage | Synthetic `schoolos-qa-coaching` sales lead WON/SQL, plan PROFESSIONAL, organization `cmvge9ndy001sqm070y71338d` | Exclude synthetic opportunity from actual revenue/win KPIs |
| Commercial Vault | 256-bit random key configured; TEST PDF category OTHER uploaded, downloaded and decrypted; AES-GCM ciphertext format `CDV1`; SHA-256 of decrypted PDF matched metadata; test document remains `UNVERIFIED` | Backup/restore encryption key custody, access audit and disaster restore |
| Contracted checkout rejection | Correct QA Coaching tenant POST `/api/v1/organization/subscription/contracted-checkout` returned **409** `SCHOOLOS_QUOTE_NOT_CONTRACTED`; invoices unchanged | Genuine signed Order Form + dual verification + TEST capture webhook |
| Existing historical QA invoice | QA School already holds one PAID Professional **Razorpay TEST** invoice with no linked signed quote, created before guard | Explicitly quarantine as synthetic legacy data; do not count as a compliant sale |

**Explicit limitation:** Both negative checkout tests verify the particular tested request and before/after invoice snapshot. They do not prove every possible checkout path, concurrent order attempt, downstream webhook delivery, or customer acceptance. The compiled policy guard and local SHA check do not substitute for positive end-to-end signed contract and settlement.

### Vault/document handling

- The uploaded PDF is **not signed** and is intentionally type `OTHER`, `UNVERIFIED`. **Never** convert its status to VERIFIED, relabel it `SIGNED_ORDER_FORM`, or bind it to a quote.
- A valid test of the positive checkout path requires a legitimately executed **QA-only Order Form** with matching `quoteNo`, actual signatory, true signing date, authorized independent verifier, lead-to-tenant link, and the application's maker/checker rules.
- For all future encrypted documents: retain securely protected encryption key backups; avoid key rotation without tested re-encryption/recovery.
- API-only secret bind mount for Razorpay is a security boundary. Disposable GitHub CI workflows must never receive staging privileged credentials.

## Newly detected GitHub monitoring and QA concerns (do not mislabel as V5 regression)

1. **Nightly staging E2E (main, run 39875552720, 2026-10-23 00:01 UTC): FAILURE.** The synthetic cross-role academic workflow sent teacher `POST /api/v1/attendance` and received HTTP 403 `CLASS_ACCESS_DENIED`: *only designated Class Teacher may mark/correct daily attendance*. Determine whether the fixture lacks class-teacher authorization or whether an intended workflow regressed. **Do not weaken class-teacher authorization to make a test pass.** Re-run with a properly authorized synthetic designated Class Teacher and retain the negative test for other teachers.
2. **Main-staging external monitor (run 39882393493, 2026-10-23 01:09 UTC): FAILURE.** Multiple connection timeouts on `main-staging.beingbrilliantedu.com:443`. Production health job was SUCCESS. Follow-up external monitor run **39909035993 at 06:01 UTC** reported SUCCESS for both staging and production; this is recovery evidence, **not** root-cause resolution. Investigate VPS/network, restart history and alert latency without touching frozen V4 production.
3. **V5 release workflows:** PR232 branch `fix/schoolos-v5-...` was excluded by `if: startsWith(github.head_ref, 'feature/schoolos-v5-')` in external smoke, and similarly in synthetic sandbox/upgrade workflows. Their SKIPPED status means QA remains outstanding. This new `feature/schoolos-v5-` Draft PR is intended to trigger those **disposable/GET-only** QA jobs through a HOLD-only manifest update. Verify actual results before claiming their completion.

## Explicit Step 75 remaining gates

All ten remain **PENDING** in `config/schoolos-v5-release-gates.json`. Current owner-operated checks advance *technical confidence* but do not meet comprehensive gate attestation.

1. Review parent PRs and pin a single candidate plus exact Docker image digests, migration count, domain/source mapping, and deployment/rollback record.
2. Complete all CI, ephemeral PostgreSQL, synthetic V4 upgrade/restore, browser and public staging smoke against the pinned source. Record run URLs, SHAs and artifacts, and investigate failures.
3. Repeat isolated restore of latest off-site backup with encrypted commercial-document decryptability and preserved school/coaching isolation.
4. For billing: signed QA-only agreement, independent documentary verification, bind, capture-only Razorpay TEST webhook, idempotent retries, renewal, refund/dispute/hold reconciliation, and no overlap/unauthorized activation.
5. Validate real AI Examiner and LiveKit provider events, provider outages/reconnect, usage metering, zero-release and manual settlement with approved unit pricing.
6. Multi-role customer UAT; privacy, cross-tenant isolation, operational support and incident response.
7. Finance/legal signoff on Essentials/Growth pricing reconciliation, Enterprise custom checkout policy, invoicing/GST, pilots, refunds, usage tariffs and customer DPA; explicit owner approval **only after** all gate evidence.

## Restrictions and operational action

- Do **not** merge this branch/PR, any of PR #230/#231/#232, or release V5 into V4 production under this audit.
- Do **not** retarget `main-staging`, update DNS, run production migrations, regenerate Vault keys, seed or impersonate real customers, or create further TEST payment orders without a legitimate verified QA signed agreement.
- This document is audit context **not** a VERIFIED gate evidence JSON: no unverifiable manual test is promoted to `release-evidence/v5/*`.
