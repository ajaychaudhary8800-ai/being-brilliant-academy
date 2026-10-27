# SchoolOS V5 launch evidence — 27 October 2026

Status: HOLD. This is an automated assessment and work register, not an independent signoff.

## Revision boundary

- Reviewed/deployed revision reported by operator: `93c2b1d58c4c881f69d74760c3f531049bf686f3` (D).
- Manifest application candidate: `1b513bd4425beb07081cf9a6446b0dbbe860edc8` (C).
- Local Git comparison confirms C..D changes only `config/schoolos-v5-release-gates.json`. Preserve this distinction; identical application trees do not prove deployed image provenance.
- This PR changes diagnostic scripts and documentation only. Its commit is not deployed, and CI on D does not validate this new PR.

## Independently retrieved automated results

GitHub API reports SUCCESS for all four workflows at D; all eight jobs report success:

| Workflow | Evidence |
|---|---|
| CI: verify + containers | https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40493334384 |
| Isolated staging sandbox | https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40493334357 |
| External browser, local private-demo browser, external smoke, coaching PostgreSQL | https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40493334422 |
| Synthetic V4 upgrade + restore | https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40493334419 |

These are workflow/job conclusions, not a fresh count of individual API assertions, real-provider payment proof or customer acceptance. No successful workflow was unnecessarily rerun.

Cloud Browser rendered the staging homepage and portal selection. Authenticated workflows were blocked by sign-in; this is not evidence of a product failure. No customer data was entered.

Operator-supplied evidence: matching API/Web revisions, six healthy services, 114 migrations with zero pending/failed, production and staging ready/operational HTTP 200. Retain as operator evidence; container labels alone are not build provenance. These checks were not repeated.

## Diagnostic correction and validation

The former staging diagnostic could return PASS without any persistent data volumes. Added failing tests demonstrated missing persistence, backup reading different uploads, and enabled paid-video flags were not rejected.

The corrected read-only diagnostic verifies the Compose-defined project-prefixed named volumes for PostgreSQL, Redis, uploads and backup archives; API and backup must reference the same upload volume. It rejects missing, duplicate, ephemeral, foreign-named or incorrectly read-only mounts, data-path overrides outside the reviewed mount and enabled/unrecognized video admission, settlement or zero-release flags. Backup may read shared uploads read-only.

Names are checked against the reviewed Compose convention. A host using different names requires inspection, not automatic volume replacement. Docker naming is a consistency check, not independent ownership or exclusive-access proof. No host paths, environment values or secrets are added to output. No volumes are created or changed.

Local validation: 30 tests passed, 0 failed across provenance, release gates, promotion lock and API/R2 credential isolation. The initial targeted run had three expected regression failures before the fix. `check-schoolos-v5-release.mjs --require-ready` returns exit 1, HOLD, 0/10; this is the expected safety veto.

## Ten-gate assessment

Every gate is PENDING: partial technical PASS evidence is insufficient for formal verification. No independent reviewer signature was supplied. D/C references below mean the exact SHAs above.

| Gate ID | Status | SHA / tests and available evidence | Outstanding blocker | Required accountable approver |
|---|---|---|---|---|
| draft_chain_integration | PENDING | D/C comparison; PR #262 open Draft, expected head matched | Cumulative dependency and source/build review | Independent engineering reviewer |
| release_candidate_ci | PENDING | D: four workflows/eight jobs SUCCESS | Attributed review; connect build source and image digest; new audit PR CI separate | Engineering/build reviewer |
| staging_migration_restore | PENDING | D: operator health/migration evidence; synthetic restore workflow PASS | Host mount audit; offsite restore with DB/files/Vault decrypt and comparisons | Operations + independent restore witness |
| subscription_payment_qa | PENDING | D: CI only, no live TEST transaction observed in this cycle | Contract-bound TEST capture, replay, forged callback, refund, renewal/dispute and ledger reconciliation | Finance/payment operations |
| ai_video_provider_qa | PENDING | D: coaching PostgreSQL workflow PASS | QA teacher/student session, actual AI output, recording through R2/LMS, failure/reconciliation; paid flags off | Provider/QA reviewer |
| security_privacy_tenant_qa | PENDING | D: automated CI; local diagnostic regression PASS on proposed changes | Authenticated cross-tenant/role/feature tests, privacy/secrets/load review | Security reviewer |
| customer_uat | PENDING | D: public browser rendering only | School/coaching workflow execution and genuine customer acceptance | Customer sponsor + QA lead |
| operational_support | PENDING | D: operator healthy services; synthetic restore PASS | Offsite restore/Vault, alert delivery, retention, incident #240 closure, rollback and on-call acceptance | Operations/support owner |
| commercial_legal_finance | PENDING | C/D source reference prices; existing controlled templates | Actual staging catalogue check; pilot collection, onboarding inclusion, V5 terms/privacy/tax approval | Finance + counsel + commercial owner |
| production_owner_approval | PENDING | C/D release checker HOLD; no promotion attempted | Other nine gates verified, final candidate/tag/rollback evidence | Ajay Chaudhary, separate explicit production GO |

## Next execution boundary

1. Authenticate to isolated staging with a QA administrator; use only synthetic QA school/coaching tenants. Teacher/student and Super Admin access need their appropriately scoped QA sessions too.
2. Obtain an authorized staging host execution surface for read-only mount/credential/build-log inspection, commercial preflight and offsite restore. No SSH/Coolify service connection was available in this execution; do not infer host access from the local workspace.
3. Run the existing read-only commercial preflight before any price mutation. Preserve historical snapshots/invoices and Razorpay TEST mode.
4. Execute the UAT/provider matrix and collect protected, sanitized evidence. Do not put tenant identities, signed contracts, credentials or provider secrets in this public repository.
5. Have named reviewers validate real evidence. Only then create SHA-pinned signed records following `SCHOOLOS_V5_RELEASE_CANDIDATE_GATES.md`.

Estimate retained from owner baseline: 80% complete / 20% remaining, change 0 percentage points. This is a planning estimate, not a measured coverage fraction. The diagnostic defect is fixed locally; no deployment, provider, customer or approval gate closed from this work alone.
