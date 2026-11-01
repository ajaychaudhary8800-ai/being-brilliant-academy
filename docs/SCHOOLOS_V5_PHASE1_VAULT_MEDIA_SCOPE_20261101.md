# SchoolOS V5 — Phase 1 Vault and Media Recovery Scope

**Status (1 Nov 2026):** OWNER-RUN SELECTED-TABLE REAL CHECKPOINT METADATA PASS; ORIGINAL KEY DECRYPTION AND R2 MEDIA HEAD/PLAYBACK NOT EXECUTED.
**Checkpoint:** 20261031T073407Z.
**Source:** stacked Draft PR #298 on #297 (do not merge or deploy to V5 staging).
**Commercial GO:** HOLD; formal gates remain unverified.

## Confirmed completed on 1 November 2026

- Owner-reported protected backup copy passed read-only integrity/structure preflight.
- Actual PostgreSQL 16 checkpoint database and files were restored into disposable Windows Docker Desktop offline storage with cleanup PASS. No V5 staging/prod modifications.
- Source checkpoint SHA256SUMS is internally consistent; independent original manifest origin authenticity NOT ATTESTED.
- Vault key custody, Vault AES-GCM decryption, external LiveKit R2 HEAD/playback, full API/Web recovery and independent image provenance remain UNVERIFIED.


## Actual private-checkpoint execution — evidence received 1 November 2026

Owner-reported sanitized outputs from checkpoint `20261031T073407Z` on protected Windows Docker Desktop:

```text
LOCAL_STORAGE_SECURITY=PASS
PREVIOUS_REAL_RECOVERY=PASS
PINNED_SCOPE_SOURCE=PASS
VAULT_MEDIA_CHECKPOINT_PREFLIGHT=PASS_CONTENT_ONLY
VAULT_MEDIA_SCOPE_ISOLATION=NETWORK_NONE_TMPFS_ONLY
VAULT_MEDIA_SCOPE_POSTGRES=PASS
VAULT_MEDIA_SCOPE_INPUT_PARITY=PASS
VAULT_MEDIA_SCOPE_SCHEMA_ONLY=PASS
VAULT_MEDIA_SCOPE_AGGREGATES=PASS
VAULT_MEDIA_SCOPE_CLEANUP=PASS
VAULT_MEDIA_METADATA_SCOPE=PASS
VAULT_DOCUMENT_ROWS=1
VAULT_INVALID_HEADERS=0
CLASSROOM_RECORDING_REFERENCES=1
MEETING_RECORDING_REFERENCES=0
STUDY_MATERIAL_EXTERNAL_REFERENCES=1
MEETING_ATTACHMENT_REFERENCES=0
VAULT_KEY_CUSTODY=NOT_VERIFIED
VAULT_DECRYPTION=NOT_EXECUTED
R2_HEAD_PLAYBACK=NOT_EXECUTED
SANITIZED_REPORT=PASS
STAGING_AND_PRODUCTION_CHANGED=NO
COMMERCIAL_GO=HOLD
```

**Acceptance limits:** Exactly one Commercial Document Vault encrypted record in DB; its CDV1 envelope/header is structurally valid but the authenticated AES-GCM tag and associated plaintext contentSha256 remain unverified without the exact original secret. One LiveClass object-storage reference and one StudyMaterial external storage reference exist; there may be additional egress/URL references that were not included in the user-supplied aggregate list. Zero MeetingRecording and MeetingAttachment storage references were reported. No R2 object was looked up, so object existence, content checksums, playback and ownership remain unverified. Independent backup-origin manifest and signed image provenance remain NOT ATTESTED. No commercial launch gate is released by this metadata test.

### Next controlled evidence to request — do not collect secrets in GitHub

1. **Vault secret provenance:** A designated authorized custodian must locate the **original** `COMMERCIAL_DOCUMENT_ENCRYPTION_KEY` in an independently protected owner-controlled secrets store (not in a compromised image, Docker history, source, log or public CI). Record only a protected store reference, key version/fingerprint computed and retained inside the protected evidence store, custody/witness/time; never paste the key or fingerprint publicly. Key must **not** be rotated or replaced before decrypt-readback/migration planning. If original key is not available, mark `VAULT_KEY_CUSTODY=BLOCKED` and retain the encrypted record.
2. **Isolated Vault decrypt:** Only after documented custody + specific owner authorization, decrypt the approved single representative document inside a no-network, disposable recovery isolate using reviewed crypto logic `sha256(UTF8 original key)` → `AES-256-GCM` with `CDV1 || IV(12) || tag(16) || ciphertext`. Authenticate the GCM tag and check the derived plaintext SHA-256 against the protected record's `contentSha256`; never print/document decrypted content or original secret. Do not use new random keys or bypass GCM authentication. Record only PASS/FAIL or BLOCKED, operation identity, approved scope and witness.
3. **R2 source mapping:** Confirm storage provider and namespace for the LiveClass recording object and the StudyMaterial external reference from approved protected configuration, without printing actual object keys in public logs. Determine whether references share a bucket or are backed by separate storage providers. Restrict any future credential to read-only `HeadObject`/metadata checks for the scoped resources; no list-all, deletion, writes, presigned public URLs or broad access. If storage configuration or safe credentials are unavailable, mark `R2_MEDIA_RECOVERY=BLOCKED` pending #293 incident remediation and owner approval. A provider HEAD PASS alone is not playback/decode acceptance.
4. **Non-mutating owner signoff:** A designated human operations/security reviewer must provide attributable custody and exception decisions, and agree on RPO/RTO before closure. Document author/date/decision without fabricating signatures. Phase 2 retains the shared staging lock; avoid any staging, production or compromised-credential inspection.

## New bounded metadata scope

The owner-local Python utility scripts/schoolos-v5-vault-media-private-scope.py requires an owner-controlled encrypted Windows checkout, the already copied checkpoint and explicit private-isolate acknowledgment. It pins the Windows Docker Desktop local named-pipe endpoint, requires existing postgres:16-alpine (does not pull), and launches a uniquely labelled, disposable PostgreSQL instance with Docker --network none, read-only checkpoint bind mount, and tmpfs-only database/file workspaces. No real staging, Coolify, R2, email, media or payment provider access.

The tool restores the full archive **schema-only pre-data** (table definitions and enum dependencies, with no customer rows), then uses pg_restore --data-only --table to populate ONLY SaaSCommercialDocument, LiveClass, StudyMaterial, MeetingRecording and MeetingAttachment in fresh disposable PostgreSQL. All other tables remain empty. This avoids missing enum/dependency failures inherent in pg_restore --table alone. Every SQL statement is a COUNT(*) aggregate from the allowlisted tables. It never outputs or queries individual document content, encrypted payloads, database record IDs, filenames, object keys, URLs, customer records, user identifiers, secrets, or original credential values. For the commercial document encryptedFileData byte column, it performs only a CDV1 format/header and length count; it does not extract or decrypt any bytes.

The separate private report includes only counts and explicit NOT_VERIFIED / NOT_EXECUTED statuses for Vault original-key custody, AES-GCM authentication, LiveKit R2 object HEAD/playback, financial ledger reconciliation and human acceptance. No recording URLs or external media keys should be retrieved or logged. A zero count is NO_DB_REFERENCE_FOUND, not a definitive N/A approval.

### Operator prerequisites

1. Verify Windows BitLocker protection remains On and the recovery key remains accessible. Keep the existing checkpoint copy and files restricted to the local owner.
2. Use an exact-head source checkout of Draft PR #298 after CI SUCCESS. Check the script/source hash before running. Do not download customer backups again.
3. Run the scoped utility in a new private local report path with the acknowledged offline-checkpoint flag. The actual backup bytes remain on the owner's encrypted machine; never upload to GitHub, chat or public temporary storage.
4. Only forward sanitized PASS/CHECK_REQUIRED result lines and aggregate **counts**, if needed for issue review. Do not forward raw reports, logs, keys, SQL output, object references or customer contents.
5. If any selected table is missing, restore fails, or scope cleanup fails, record CHECK_REQUIRED and halt; never bypass with a live staging query.

### Acceptance interpretation

| Item | Actual outcome needed | Current state |
| --- | --- | --- |
| RC-06 scope | 1 encrypted Vault document; 0 CDV1 header/length failures | PASS_OWNER_REPORTED_ACTUAL_CHECKPOINT_SCOPE_ONLY |
| RC-06 key custody | Original key version/alias and secure storage provenance | NOT VERIFIED |
| RC-06 decryption | Approved representative payload AES-GCM decrypt and digest match | NOT EXECUTED |
| RC-07 reference scope | LiveClass recording object references 1; MeetingRecording references 0; StudyMaterial external references 1; MeetingAttachment references 0 | PASS_OWNER_REPORTED_ACTUAL_CHECKPOINT_SCOPE_ONLY |
| RC-07 recovery | Original object-store read-only HEAD and approved playback/decode | NOT EXECUTED |
| RC-09 app | Authenticated API/Web restore with no outbound callbacks and tenant readback | NOT EXECUTED |
| RC-10 owner/witness | RPO, RTO, reviewer approval and protected evidence | PENDING |

All remaining requirements under #292/#293 and Phase 2 staging lock remain in force. Old broken API image TAR is deployment-vetoed; commercial release HOLD.
