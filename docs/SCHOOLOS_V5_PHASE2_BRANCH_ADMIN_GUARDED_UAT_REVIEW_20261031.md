# SchoolOS V5 Phase 2 — guarded BBA Branch Administrator operator acceptance package (31 Oct 2026)

**STATUS: SOURCE/OFFLINE PREPARATION ONLY — NOT EXECUTED ON STAGING.**
Current Phase 2 Draft PR #290 source head before this evidence-only note: `4fe06a86d9a7675301ecdc930424ceac6c341f15`. The API/Web endpoint, management UI and PostgreSQL appointment-race integration tests have exact-head CI PASS at GitHub Actions run `41175944577` (verify and containers). This is not tenant-runtime acceptance.

## Operator-only package

A separately created **conversation artifact**, not committed executable code and not an automated approval, is named `schoolos_v5_phase2_branch_admin_guarded_package_20261031.zip`. Package checksum SHA-256: `75aa167b02e29b027da6ddc1a228576fdafdf162fadcaf1659401bd176055011`.

Contents:
- `schoolos_v5_phase2_bba_branch_admin_guarded_uat.py` — Python compile PASS; source SHA-256 `277c5a28e3833a028b49a3524f2f294ceaabfd2055f1f15314296cb971bfe773`.
- `test_schoolos_v5_phase2_bba_branch_admin_guarded_uat.py` — **six offline-only tests PASS** (unsafe path; invalid SHA; synthetic campus guard; exact NDG scope; existing email collision; harmless malformed-payload SUPER_ADMIN denial probe).
- `README.txt` — operator runbook and stop criteria.

The previously prepared `schoolos_v5_bba_branch_admin_acceptance_guarded_20261031.py` was not recovered as exact source in this conversation. This new implementation has a **different filename, review hash and independent offline tests**; do not claim it is identical to or replaces the prior artifact.

## Mandatory safety / stop gates

1. Phase 1 Issue #293 **P0 exposure containment, clean image replacement and appropriate PostgreSQL/Redis rotation** documented and approved by accountable owner, with restricted incident artifacts. Image history classification of API/Web/Nginx/backup is a source of evidence, not remediation.
2. Phase 1 Issue #292 **recovery/rollback path**, immutable image provenance and DB compatibility approved for the exact staging change, not inferred from synthetic CI image roundtrip.
3. Authoritative Issue #258 supplies **recorded, exclusive staging lock/window, deployment operator, reviewed source SHA + image IDs and rollback decision**. Do not overlap Phase 1, Phase 2 and Phase 3 staging writes.
4. Phase 2 #290 API+Web actually deployed with exact matching healthy V5 staging image revision labels. Do not attempt Branch Admin acceptance on earlier `b54dca5...` API.
5. Controlled administrator inbox owner has supplied privately; verify **actual control and delivery**, check tenant/local and global account collisions, and do not change existing role or provision another account on failure.

## Guarded execution design (NOT RUN)

The artifact refuses to start without `--external-gates-cleared` (a human operator assertion, **not an authenticated GitHub clearance check**) and a 40-hex `--approved-sha` matching *both* healthy V5 staging API and Web Docker labels. Requires local V5 VPS Docker and explicit phase selection; fixed staging host and tenant only. Password and email inputs are hidden; only sanitized result codes printed. It performs ordinary login/logout session writes only.

- `--phase preflight`: BBA SUPER_ADMIN authenticates; confirms exact `org_default`, distinct synthetic NDG/RNE/SHN branches, NDG active/unassigned; tenant-local candidate email search must return zero exact matches. Prints only existing synthetic RNE/SHN branch IDs for follow-up, not names/emails. **Global email uniqueness and actual inbox ownership are separate checks.**
- **Operator UI step (not scripted):** one reviewed, authorized appointment of nominated manager to pre-existing NDG, one-time setup email delivered and user completes setup. If delivery fails, use existing scoped `POST /api/v1/admin/users/:id/setup-email` resend workflow for the **same** account; no SQL insert, duplicate or role conversion.
- `--phase accept`: activated BRANCH_ADMIN logs in; must see exactly NDG, read own branch/students, and receive 403/404 for existing RNE/SHN branch+student reads. A deliberately invalid CUID and invalid email/name are used for SUPER_ADMIN-only POST denial (expected 403), so a broken authorization gate cannot mutate a real branch. No student/content writes.

The executable has not been run against live staging. The user-designated Gmail is not copied into this repository. Do not publish bearer tokens, password links, raw API errors or private student data. An owner-operated, signed BBA institutional acceptance and related-party waiver are **separate** from any technical PASS.

**Planning ledger unchanged:** Phase 2 3.70/5.00pp = **74% complete**, 1.30pp = **26% pending**: Branch Admin UAT 0.40pp, AI Examiner 0.45pp (provider disabled last observed), institution witness/signoff 0.45pp. Provisional overall original backlog 14.30pp, not risk-weighted. Formal release gates **0/10 VERIFIED**; commercial GO **HOLD**. Production unchanged.


## 31 Oct guarded package v2 — false-positive cross-branch denial prevention (offline only)

**Supersedes v1 operator package for future UAT; v1 hashes above are historical evidence only.** A code review of the first guarded script exposed a possible *false-positive acceptance*: a caller could pass arbitrary syntactically valid CUIDs rather than the actual RNE/SHN fixture IDs, and their HTTP 404 replies would count as cross-branch denial. This would not demonstrate that an actual student/branch object belonging to Rajnagar Extension or Shastri Nagar was inaccessible.

**Correction:** Before running BRANCH_ADMIN negative authorization probes, accept phase now performs a separate actual BBA SUPER_ADMIN authenticated read of the three synthetic branch records, verifies the operator-provided RNE and SHN identifiers match exactly the existing source records in the intended order, and enforces all three IDs are distinct. Both sessions are explicitly logged out. An invented-but-valid CUID, swapped branch IDs, or NDG substituted for RNE fails closed.

- Updated operator package (private ChatGPT conversation download; not committed executable source): `schoolos_v5_phase2_branch_admin_guarded_package_v2_20261031.zip`
- Package SHA-256: `0c89047f63aa0d324237e5f5b330eb4ce552266fac2d088226ff76856fc514f7`.
- Script SHA-256: `b38725113f52bbd9b0d564d1913019ece619e63e00d85569b7a96ed21b1e4c95`.
- Python compilation **PASS**; **9/9 offline mock safety tests PASS** (three new actual-fixture-identity negative/positive cases). Guard default without explicit external clearance **FAIL-CLOSED** before contacting Docker or staging.
- **No authenticated staging execution; no account or mail created**. V2 has not verified real RNE/SHN branch IDs or performed a live UAT.
- Gate dependencies in #292, #293, #258, exact deployed Phase 2 API/Web image and independently validated controlled inbox remain unchanged.
- This is evidence-quality hardening. Do not add Phase 2 UAT credit or declare commercial readiness.

