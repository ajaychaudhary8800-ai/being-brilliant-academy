# SchoolOS V5 — Original Commercial Vault Key Readback (Restricted)

**Status 1 Nov 2026:** Preparation and synthetic validation ONLY. Real original-key AES-GCM recovery is BLOCKED until trusted original-key escrow and independent owner/security approval.
**Original checkpoint:** `20261031T073407Z`; owner-private protected Windows recovery workspace.
**Live environments:** V5 staging and V4 production MUST NOT be modified or queried for customer data; Phase 2 retains staging lock. Credential incident #293 remains OPEN.

## What is established

- Actual PostgreSQL database and files have been restored inside an offline disposable isolate (owner reported PASS).
- A separate offline real-checkpoint metadata scope found **one** Commercial Vault ciphertext envelope with `CDV1` format and zero malformed headers; one classroom recording object reference and one study-material external storage reference.
- Owner's safe, read-only SSH existence-only check to a protected API env file returned `VAULT_KEY_ENTRY=PRESENT_NONEMPTY`. That **does not prove** the secret is the original key, backed up independently, safe after the incident, or cryptographically usable with the Vault document.
- Source review: `apps/api/src/lib/commercial-document-crypto.ts` derives the AES-256-GCM key as `SHA256(UTF8 original string)`; encrypted format `CDV1 || 12-byte IV || 16-byte GCM tag || ciphertext`. The stored `SaaSCommercialDocument.contentSha256` digest is the expected decrypted-document SHA-256.

## This PR: testable readback without live key handling

- `scripts/schoolos-v5-vault-offline-aesgcm.mjs`: Node.js standard-library-only GCM-authenticated decrypt and constant-time SHA-256 digest comparison; zero plaintext/key/ciphertext output. CLI self-test generates disposable synthetic key+PDF bytes and verifies success, wrong-key rejection, ciphertext-tamper rejection and wrong digest/size rejection. No network calls.
- `scripts/schoolos-v5-vault-private-readback.py`: operator-only isolated verification against the **already privately copied checkpoint**. Refuses non-Windows execution, checks C: BitLocker On, demands a preexisting `protected-escrow/original-vault-key.txt` under the restricted recovery workspace, verifies backup checksum integrity, requires local Docker Desktop `desktop-linux` and cached PostgreSQL 16, uses network-none and tmpfs-only disposable PostgreSQL with read-only checkpoint bind, schema-only pre-data then only `SaaSCommercialDocument` data, requires exactly one row, fetches the encrypted payload and expected digest entirely into memory without logging, invokes local Node AES-GCM checker with the owner-local secret file path only, discards plaintext without saving/printing, writes an aggregate-only report, and checks owned-container cleanup.
- Synthetic Python unit tests vet the escrow location gate, absence of customer data output, SQL selection, one-table constraint, isolated-container cleanup and failure veto. CI runs the Node crypto/tamper test and the Python suite; no real secrets or backups are loaded into CI.

## Critical requirements before ACTUAL execution

1. An authorized custodian independently recovers and validates the **original**, unchanged Commercial Vault encryption secret into the approved local encrypted owner-controlled private escrow. The present staging config is **not** sufficient proof of source integrity or independent backup. Do not SSH/copy/screen-share/show/print the secret from the incident-affected staging runtime while #293 containment is unresolved.
2. Escrow the exact UTF-8 key as one raw line in `protected-escrow/original-vault-key.txt` under the owner-private recovery workspace. It must be available only to the authorized local owner with restrictive ACL, must not reside in OneDrive/synced folders, and must not be placed under checkpoint, Git or reports. The utility does NOT auto-generate, rotate, repair, export or retrieve the secret.
3. Obtain explicit owner/qualified security reviewer scope approval and confirm the source-pinned exact-head CI is successful; document restricted key custody and protected reference privately. Do NOT commit any key, ciphertext, backup, fingerprint or raw report to GitHub.
4. Run only on the protected Windows machine using the reviewed PR source with private checkpoint path, an explicit flag, and a fresh private report path. Never run on staging VPS or shared Coolify. This procedure is not an invitation to transfer the existing key from staging; if no trusted independent escrow exists, stop here with `VAULT_KEY_CUSTODY=BLOCKED_OR_NOT_VERIFIED`.
5. If the offline readback passes, record only `VAULT_OFFLINE_AUTHENTICATED_READBACK=PASS`, source commit, owner/witness and controlled report reference. This proves that **the supplied local key** decrypts **the restored encrypted document** and its original SHA-256 matches. It does not prove independent secret origin, live runtime state, R2 data restoration, signed image provenance, or commercial readiness.

## Executable examples (do NOT run until prerequisite escrow and clearance)

```powershell
# Protected owner-local PowerShell session, after independent escrow is established:
$base = '<restricted SchoolOS-V5-Recovery-* folder on BitLocker C:>'
$source = Join-Path $base 'vault-readback-source'  # exact pinned PR source
$checkpoint = Join-Path $base '20261031T073407Z'
$escrow = Join-Path $base 'protected-escrow\original-vault-key.txt'
$report = Join-Path $base ('reports\vault-gcm-' + [guid]::NewGuid().ToString('N') + '.json')
& py -3 -B (Join-Path $source 'scripts\schoolos-v5-vault-private-readback.py') `
  --checkpoint-dir $checkpoint `
  --checkpoint-id 20261031T073407Z `
  --escrow-key-file $escrow `
  --report $report `
  --acknowledge-private-offline-checkpoint
```

## Blockers not waived

Vault key original custody independently attested: PENDING; restricted actual AES-GCM decrypt: NOT EXECUTED; R2 classroom recording and external StudyMaterial object existence/playback: NOT EXECUTED; independent original backup manifest and source-image provenance: NOT ATTESTED; #292 immutable rollback and #293 exposed build-layer credentials OPEN; 10 formal commercial release gates 0 VERIFIED; GO HOLD.
