# SchoolOS V5 — Phase 1 Vault and Media Recovery Scope

**Status:** SELECTED-TABLE METADATA TOOL PREPARED; ORIGINAL KEY DECRYPTION AND R2 MEDIA HEAD/PLAYBACK NOT EXECUTED.
**Checkpoint:** 20261031T073407Z.
**Source:** stacked Draft PR #298 on #297 (do not merge or deploy to V5 staging).
**Commercial GO:** HOLD; formal gates remain unverified.

## Confirmed completed on 1 November 2026

- Owner-reported protected backup copy passed read-only integrity/structure preflight.
- Actual PostgreSQL 16 checkpoint database and files were restored into disposable Windows Docker Desktop offline storage with cleanup PASS. No V5 staging/prod modifications.
- Source checkpoint SHA256SUMS is internally consistent; independent original manifest origin authenticity NOT ATTESTED.
- Vault key custody, Vault AES-GCM decryption, external LiveKit R2 HEAD/playback, full API/Web recovery and independent image provenance remain UNVERIFIED.

## New bounded metadata scope

The owner-local Python utility scripts/schoolos-v5-vault-media-private-scope.py requires an owner-controlled encrypted Windows checkout, the already copied checkpoint and explicit private-isolate acknowledgment. It pins the Windows Docker Desktop local named-pipe endpoint, requires existing postgres:16-alpine (does not pull), and launches a uniquely labelled, disposable PostgreSQL instance with Docker --network none, read-only checkpoint bind mount, and tmpfs-only database/file workspaces. No real staging, Coolify, R2, email, media or payment provider access.

The tool uses pg_restore --table to restore ONLY SaaSCommercialDocument, LiveClass, StudyMaterial, MeetingRecording and MeetingAttachment into a fresh disposable PostgreSQL. Every SQL statement is a COUNT(*) aggregate from the allowlisted tables. It never outputs or queries individual document content, encrypted payloads, database record IDs, filenames, object keys, URLs, customer records, user identifiers, secrets, or original credential values. For the commercial document encryptedFileData byte column, it performs only a CDV1 format/header and length count; it does not extract or decrypt any bytes.

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
| RC-06 scope | Encrypted document row count and CDV1 envelope format count | NOT RUN ON ACTUAL CHECKPOINT |
| RC-06 key custody | Original key version/alias and secure storage provenance | NOT VERIFIED |
| RC-06 decryption | Approved representative payload AES-GCM decrypt and digest match | NOT EXECUTED |
| RC-07 reference scope | LiveClass, MeetingRecording, StudyMaterial, MeetingAttachment reference counts | NOT RUN ON ACTUAL CHECKPOINT |
| RC-07 recovery | Original object-store read-only HEAD and approved playback/decode | NOT EXECUTED |
| RC-09 app | Authenticated API/Web restore with no outbound callbacks and tenant readback | NOT EXECUTED |
| RC-10 owner/witness | RPO, RTO, reviewer approval and protected evidence | PENDING |

All remaining requirements under #292/#293 and Phase 2 staging lock remain in force. Old broken API image TAR is deployment-vetoed; commercial release HOLD.
