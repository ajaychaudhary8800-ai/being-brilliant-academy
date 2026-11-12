# SchoolOS V5 — Phase 1/2/3 isolated source-integration security checkpoint

**Date:** 3 November 2026. **Scope:** isolated GitHub PR #307 only.
**Release board:** Issue #258. **Status:** DRAFT / NOT AUTHORIZED FOR DEPLOYMENT.

## Independently verified source evidence

- Phase 1 clean-image guard: Draft PR #306, source commit `3b42092db6f35dca989f2f10a8bb3ecf6b66212f`.
  GitHub Actions exact-head CI run `41608400411`: **completed SUCCESS** (verify and containers).
  Observed `V5_LAYER_PUBLISH_GATE=PASS_BOUNDED_CHECKS_NOT_SIGNED_PROVENANCE`.
- All three disposable CI-built images (API, Web and backup) reported **0** dependency PEM-header findings in bounded full-layer scans, after strict whole-document SHA-256 verification and pre-runtime-copy removal of two upstream `dotenv@16.6.1` public example READMEs (English and Spanish).
- The Spanish sample documentation was independently identified in public upstream `dotenv` v16.6.1 tag with pinned SHA-256 `a7021cf039feb04752c5cde82f07336dec6e17876e88677d7c5de4c2dbbbcff1`. Both pinned files are deleted ONLY upon full-document hash match; missing, edited and alternate-path files remain fail-closed. No private credential data or image archives were read.
- Phase 2 PR #290 source `d937a874d6e02228db8263a98658a233ae1f4256`: **38/38 changed source blobs preserved**.
- Phase 3 PR #294 source `519c64455733885e6c666c8fb44d59086e6cb610`: **22/22 changed source blobs preserved**.
- Combined source before checkpoint document: `e79ee4278c783aa1add7acc6654e111c19774f6b`; this document commit changes the integration HEAD. Exact-new-HEAD integration CI requires its **own** success result, not the old Phase 1 or earlier integration result.
- Prior isolated new→previous→new API boots with synthetic nonempty tenant/branch/role/plan/zero-value invoice records passed in run `41599701780`. This was synthetic, not actual staging-database compatibility.

## Explicitly not established

1. Signed immutable source-to-OCI provenance, restricted registry copy and independent retrieval, or verified **previous deployed** API/Web rollback images.
2. Historical PostgreSQL/Redis credential invalidation, archive/registry audience containment, or actual incident closure (#293).
3. Runtime security scope/human signoff (#281), actual customer-data DB rollback compatibility (#292), or maintenance window/handoff.
4. Real BBA Branch Administrator portal UAT, a configured AI Examiner provider/copy evaluation, original dated institution signatures (Phase 2 remains 74% evidenced and 26% pending).
5. Real Razorpay **TEST** signed callback-to-ledger/settlement acceptance and independent finance reviewer acceptance (Phase 3 full-task acceptance 0/3).
6. Signed commercial release or V5 production deployment. All ten formal release gates remain pending; **GO HOLD**.

**Safety:** Source-only; no live staging/V4, VPS environment, encrypted archive, credential, customer data or real payment changes.
