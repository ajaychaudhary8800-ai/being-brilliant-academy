# SchoolOS V5 — Phase 4 security, privacy and DR acceptance register

**Read-only evidence reconciliation · 3 November 2026 · NOT A SECURITY CERTIFICATION.** Source of truth: [Issue #258](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/258), [#281](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/281), [#292](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/292), [#293](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/issues/293), [security source review](SCHOOLOS_V5_SECURITY_SOURCE_REVIEW_20261029.md), [release gates](SCHOOLOS_V5_RELEASE_CANDIDATE_GATES.md). Do not copy historical logs or raw Docker configuration into public GitHub.

## Evidence classification and original custody
- `SYNTHETIC_CI`: source tests or disposable data; no actual production tenant/credential conclusion.
- `OPERATOR_REPORTED`: sanitized owner terminal output/screenshot; preserve original UTC time, machine scope, reviewed command hash and private artifact locator.
- `LIVE_READ_ONLY`: source-tied read-only inspection, but not a security opinion or cryptographically signed artifact.
- `WITNESSED_ACCEPTED`: dated human decision tied to original protected evidence; **NONE accepted by this document**.
- `BLOCKED_BY_PHASE_1/2/3`: prerequisites not satisfied; never silently convert to PASS.

| Control | Evidence already reported / reuse | Missing acceptance proof | Status |
|---|---|---|---|
| Account/authentication | Previously reported admin login/refresh, synthetic unauthorized 403/404, tenant role checks | Actual target candidate + real school/coaching role negative review | BLOCKED_BY_PHASE_1 + PHASE_2 |
| Tenant/branch isolation | Synthetic multi-tenant coaching/section restrictions; negative cross-branch access. **New source finding:** `/admin/overview` was accessible to branch admins but calculated tenant-wide aggregates; stacked [#315](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/pull/315) proposes role-scoped counts and withheld invoice revenue. | Exact-head #315 CI and isolated PostgreSQL branch-vs-tenant-negative checks; authorized deployed BBA observation and privacy impact review. No production exposure asserted. | SOURCE DEFECT IDENTIFIED; FIX DRAFT; BLOCKED_BY_PHASE_2 |
| Secure media/AI credentials | Earlier protected API-only LiveKit/R2 service setup, owner-reported provider rotation | Signed scope review of all former recipients and credential continuity | BLOCKED_BY_PHASE_1 |
| Non-API core secrets (#281) | **3 Nov** current 6 non-API services showed `API_ONLY_RUNTIME_NONEMPTY_NAMES=NONE`; 7 image Config.Env checks `NONE` by operator corrected scanner | Historical exposure analysis, independent/owner human risk review and scoped signoff | TECHNICAL_SUBTEST_EVIDENCED; FORMAL HOLD |
| Historical build metadata (#293) | Archived Web image previously exposed real Postgres/Redis values; later five custom-image histories contain key-name references only | Restricted archive/registry custody, complete sensitive-value/layer assessment, approved DB/Redis rotation + negative auth validation, risk decision | BLOCKED_BY_PHASE_1 |
| Signed source↔OCI provenance (#292) | Historical-source synthetic previous→current-schema boot/re-forward and bounded layer scan passed on PR #310; active image IDs inventoried | Retrievable immutable **previous** API+Web pair, genuine signatures, exact provenance, live data compatibility scope and backup-specific recovery approval | BLOCKED_BY_PHASE_1 |
| PostgreSQL/backup recovery | Operator 3 Nov private 20261031T073407Z isolated DB/files restore and checksum input reported PASS; 3 Nov R2 local manifest parity PASS | Cryptographic origin authenticity, nonempty Vault/media applicability, actual recoverable app pairing, human signoff | PARTIAL_TECHNICAL_EVIDENCE |
| Monitoring and incident management | Existing nightly backup monitor, off-host availability and Telegram setup signals reported | Verified DOWN and RECOVERY recipient receipt, worker alert, named backup responder, #240 RCA/risk decision | BLOCKED_BY_PHASE_1 / OPERATIONS |
| Payments and financial confidentiality | Synthetic signed webhook replay/negative-path safeguards, draft #294 | Actual TEST records, contract/invoice/ledger reconciliation, finance confidentiality review | BLOCKED_BY_PHASE_3 |
| Child/guardian records | Controlled DPA/privacy/exit drafts, tenant guards and role semantics | Legal review of actual collection/retention/guardian processing, approved access and breach response; no PII in evidence | REVIEW_PENDING |

## Identity and authorization review procedure
Document exact identity provider/source, session refresh and revocation, MFA if actually available, least privilege of platform vs institution admins, teacher assignment, parent-child linkage, direct API negative cases, expired/disabled roles and privileged audit logs. Test across two synthetic tenants and all permitted branches with deterministic fixture IDs; require no cross-tenant return, export, search or attachment download. Verify aggregate dashboards too: a branch administrator must not learn another branch's counts or tenant-level financial totals through `/admin/overview`; ensure values are scoped or explicitly withheld rather than fabricating a zero. A branch administrator's same-role request to `/admin/users/:id/role` must reject unauthorized or protected targets even if no role mutation is requested; stacked #315 supplies policy and disposable authenticated PostgreSQL HTTP negative tests. A hidden navigation item is not access control. On any tenant-leak finding, declare P1, secure logs, suspend the affected workflow by approved incident process and do not publish details.

## Backup / restoration and rollback acceptance matrix
| Recovery step | Required artifact | Current disposition |
|---|---|---|
| Checkpoint custody | Exact timestamp, store, file manifest and SHA-256 integrity; restricted access | 20261031T073407Z owner-reported DB/files restore PASS; offsite manifest parity PASS |
| Authentic origin | Signed or otherwise independently authenticated original manifest | NOT CRYPTOGRAPHICALLY ATTESTED |
| Database / migrations | Disposable pg_restore and schema health + representative preserved marker | OWNER-REPORTED PASS for checkpoint; synthetic previous API on current schema PASS for separate job |
| Files and Vault | Nonempty files and actual app Vault decryption under approved keys where applicable | Vault/media full recovery NOT ATTESTED |
| Provider recording | Authorized R2 playback and object relationship to tenant after restore | Prior synthetic recording PASS, real checkpoint recovery NOT ATTESTED |
| Previous app binaries | Immutable approved retrievable older API+Web digests with source-to-image attestation | MISSING (#292) |
| Database backward compatibility | Schema/data semantics and genuine customer migration impact reviewed | SYNTHETIC BOOT PASS, REAL DATA NOT VERIFIED |
| Restore/rollback operator | Named primary and backup, no live mutation without approved window | COVERAGE UNVERIFIED |
| RPO/RTO | Measured observed elapsed times and data loss; explicit contractual decision | NOT ACCEPTED |

## Incident closure checklist
**#281**: exact current non-API secret absence is a positive bounded technical observation, but incident must retain scope, source/image binding, date, all seven services (including stopped migrate), exposure risk and human signoff.  
**#293**: preserve restricted forensic originals, classify live/archived/registry reach, implement clean build without plaintext build args/history, execute **approved** PostgreSQL/Redis rotation with compatibility and API/database connectivity/old-secret rejection, record residual risk. Do not rotate Vault/payment encryption keys casually.  
**#292**: independently retrievable signed approved older images and compatible recovery rehearsal (or human-reviewed alternate recover-and-rollforward) before rollback readiness.  
**#240**: RCA or explicit residual-risk decision; monitor-specific failure and recovery delivery; named primary/backup coverage.
Do **not** close an issue on the strength of an evidence checklist alone.

## Confidentiality and review package
Source evidence must be minimally sufficient: recorded operation and UTC time, actual environment, candidate and active image hashes, expected/observed sanitized results, exception and source reference, chain-of-custody, protected original locator and permitted document digest. Never include passwords, Docker RUN history, raw .env, financial account details, live child data, tokens, Vault ciphertext or protected customer paperwork in public issues. The [DPA](legal-sales/06_DATA_PROCESSING_ADDENDUM.md), [Privacy Notice](legal-sales/07_PRIVACY_NOTICE.md), [Security Schedule](legal-sales/10_SECURITY_SCHEDULE.md), and [Data Exit & Retention](legal-sales/09_DATA_EXIT_RETENTION.md) are controlled templates requiring qualified applicability review.

### Security/operations signatory packet — empty decision fields
| Field | Required record | Status |
|---|---|---|
| Accountable human | Ajay Chaudhary, owner-led AI-assisted internal review model and conflict disclosure | ROLE CONFIRMED; ASSESSMENT PENDING |
| Assessment | Actual limited-scope technical findings, original protected evidence and unresolved defects | PENDING |
| External-audit applicability | Determine binding law/contract/insurer obligations and evidence of that decision | PENDING |
| Risk acceptance | Specific risks/exceptions, controls, expiry, signed and dated original locator | PENDING |
| Operations reviewer | Backup roster, alert acknowledgments, DR/rollback, #240 disposition | PENDING |
| Outcome | ACCEPT / CONDITIONAL / REJECT with exact V5 SHA and original signature | PENDING |

**Gate 3, Gate 6, Gate 8 and Gate 10: PENDING.** This review pack is an independent documentation task only; no live credential inspection or rotation, backup restore, source merge, staging deployment or authorized signature occurred.
