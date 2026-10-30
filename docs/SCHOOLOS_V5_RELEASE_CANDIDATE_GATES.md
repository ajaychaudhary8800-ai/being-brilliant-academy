# Adhyay SchoolOS Version 5 — Release Candidate and 100% Verification Protocol

**Current status: HOLD. Version 5 is NOT 100% verified and NOT approved for production.**

Stage 7G1 adds a **machine-enforced release GO / HOLD decision**, separate from the subjective percentage of feature development. It does not pretend that green isolated Draft-PR CI proves staging, payment, legal or customer acceptance. Frozen ERP 4.0 `main` is unaffected.

## Release candidate integration sequence

1. Inspect staged Draft PR dependencies and the latest **head SHAs** from #179 onward. Reconcile parallel #194 before integration; do not duplicate payment-failure recovery. Incorporate independent V5 coaching-mode PR only after isolating scope and verifying tenant controls.
2. Cut an **isolated candidate integration branch** from the approved frozen V4 baseline. Apply the reviewed feature chain in dependency order; resolve conflicts and rerun Prisma schema-generation/route mounts after every boundary. No unreviewed Draft PR is authorized for direct production merge.
3. Pin the full 40-character integrated candidate commit in `config/schoolos-v5-release-gates.json`. Any subsequent code change changes the candidate SHA and invalidates previously pinned evidence.
4. Execute full PostgreSQL migration and isolated restoration of a verified V4 backup, compare tenant/user/ledger migration counts, test prohibited rollback and data-access boundaries. Rehearse restore before staging promotion.
5. Execute the acceptance matrix in `config/schoolos-v5-release-gates.json` against the **same candidate commit**. Collect independently signed/commercially approved reports for every gate, including real-provider AI and LiveKit failure/reconnect tests and TEST Razorpay.
6. Do not enable `SCHOOLOS_AI_METERING_TENANT_IDS`, `SCHOOLOS_VIDEO_ADMISSION_ENABLED`, `SCHOOLOS_VIDEO_SETTLEMENT_ENABLED` or `SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED` for customer tenants before tariff, proof and payment approval. Separate staging and production authorizations are required.
7. Request formal approval to promote only after `pnpm v5:release:require-ready` succeeds for the exact candidate and the business owner signs the production deployment gate.

## Evidence requirements

Each gate starts PENDING. A reviewer may change it to VERIFIED **only** after independent validation, and must attach one or more `release-evidence/v5/<name>.json` files to the candidate. Each evidence record must contain:

```json
{
  "product": "Adhyay SchoolOS",
  "version": "5.0",
  "gateId": "staging_migration_restore",
  "releaseCandidateSha": "<full 40-digit candidate commit SHA>",
  "result": "PASS",
  "verifiedBy": "<real accountable external or internal reviewer>",
  "verifiedAt": "2026-10-19T12:00:00Z",
  "summary": "<at least thirty characters describing verified acceptance>"
}
```

### Paid-release security assurance — explicit owner-led alternative

An early-stage company may elect an **owner-led, AI-assisted internal security review**, with a named human accountable for the assessed risks. This is an **internal risk acceptance**, NOT an independent security certificate, penetration test, professional legal opinion or guarantee that the code is secure. A different qualified reviewer remains necessary where a binding law, regulation, insurer or customer contract requires one. Resolve audit applicability before proceeding.

For `security_privacy_tenant_qa`, the signed, attributable evidence record must contain an actual assessment reference plus a truthful `securityReview` metadata object. The valid models are:

- `INDEPENDENT_HUMAN`, with `assessmentReference` to the original independent assessment.
- `OWNER_LED_AI_ASSISTED`, with `accountableHuman` matching `verifiedBy`; `aiRole: "ASSISTIVE_ONLY"`; `conflictOfInterestDisclosed: true`; `independentCertificationClaimed: false`; `externalAuditApplicabilityReviewed: true`; and non-PII protected `assessmentReference`, `applicabilityDecisionReference` and `signedRiskAcceptanceReference`. A generic owner statement without these real records is NOT a passing gate.

The AI is an analytical assistant, **never the legal signatory or a substitute for actual testing**. The signer must identify residual findings, tenant/privacy exposure, historical credential incident #281, incident #240, key continuity and privacy of child data. Customer/contract requirements can override this internal governance alternative.

### Paid customer acceptance — independent or **disclosed related-party** UAT

The `customer_uat` gate must contain actual human-observed institutional acceptance, signed by an authorized representative, anchored to the exact candidate SHA and actual tenant. The institution can be:

1. `INDEPENDENT_EXTERNAL`: a genuine unrelated external institution. Require `institutionReference` and `signedAcceptanceReference`.
2. `OWNER_OPERATED_RELATED_PARTY`: Being Brilliant Academy or another institution controlled by the software owner. Require the above two references **plus** `authorizedHumanSignatory`, `relatedPartyDisclosure: true`, `relatedPartyWaiverReference` and `observedScenarioEvidenceReference`. The original related-party conflict waiver must be human approved. The original BBA UAT matrix must record actually witnessed scenarios, tenant, roles, source SHA, defects and exclusions. Do not turn synthetic `schoolos-qa-coaching` tests or a generic blanket approval into human observations.

Example **structure only**, with deliberately fictitious references that are NOT evidence:

```json
{
  "customerUat": {
    "institutionRelationship": "OWNER_OPERATED_RELATED_PARTY",
    "institutionReference": "restricted-bba-institution-original",
    "signedAcceptanceReference": "restricted-bba-uat-signed-original",
    "authorizedHumanSignatory": "Ajay Chaudhary",
    "relatedPartyDisclosure": true,
    "relatedPartyWaiverReference": "restricted-bba-conflict-signed-original",
    "observedScenarioEvidenceReference": "restricted-bba-actual-observations"
  }
}
```

This model was authorized as a governance choice by the owner, but **passing validation requires real, later-obtained signed references and verified tests**. Passing metadata syntax only proves structural consistency. It cannot establish genuine signatures, successful institutional UAT, customer independence or actual risk acceptance. The committee may still choose to require an independent pilot for credibility or a specific contract.

**Current state stays HOLD.** No evidence files, signed UAT forms or human assessments have been provided for these two gates in the current release manifest. Never insert invented references or claim `READY` for an unsigned record.

Record the **actual** SHA-256 of each evidence JSON file in the corresponding gate's `evidence` array as `{"path":"release-evidence/v5/staging_migration_restore.json","sha256":"<actual 64-digit digest>"}`. Put detailed test logs, restore checksums and signed records in protected internal storage according to the organization's retention/security policy; avoid embedding credentials, student PII or financial secrets in Git.

This checker establishes traceable file integrity and revision pinning, **not the truth of a manually authored PASS statement**. A second party must inspect the underlying logs and verify signing/approval. CI cannot self-approve those business decisions.

## Commands

- `pnpm v5:release:test` — run policy regression tests for false READY declarations, missing gates, tampering and wrong SHA.
- `pnpm v5:release:check` — informational; returns success for a structurally valid HOLD.
- `pnpm v5:release:require-ready` — fails with exit 1 for a valid HOLD and exit 2 for an invalid manifest. A production deployment job must require this, plus independent environment-protection approval.

## Launch blockers as of 19 October 2026

All ten evidence gates are currently PENDING, because an integrated V5 release candidate has not been validated end-to-end. This **does not mean 0% of feature code exists**: the last engineering progress estimate was approximately **88%**, while **0/10 independently signed final release gates** have verified evidence. Completion percentages are planning estimates; only verified staged acceptance and commercial owner approval permit the precise term 100% release ready.

Do not auto-merge, activate paid provider services, run production migrations or deploy the frozen V4 main in order to satisfy this document.
