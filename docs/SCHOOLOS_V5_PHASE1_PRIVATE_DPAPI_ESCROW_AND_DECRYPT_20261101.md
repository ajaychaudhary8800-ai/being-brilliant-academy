# SchoolOS V5 — Protected Original Vault-Key Custody and Offline Decrypt Test

**Scope**: V5 staging checkpoint 20261031T073407Z; Vault column `SaaSCommercialDocument.encryptedFileData`, exactly one DB row. Controlled owner-local recovery, without changing V5 staging or production.
**Decision**: This is an owner-authorized **read-only transfer of only the Commercial Document Vault key**, not a blanket copy of server credentials. The unrelated PostgreSQL/Redis #293 build-history exposure and #281 six-container runtime leak remain OPEN. Do not rotate/overwrite any key from this procedure.

## Established evidence

- Owner's BitLocker C: reported 100% encrypted, ProtectionStatus On, TPM and RecoveryPassword present, recovery key owner confirmed backed up.
- Owner copied real checkpoint to private ACL-restricted LOCALAPPDATA workspace. Real PostgreSQL and archived files restore PASS; selected metadata scope found 1 Vault document, zero invalid `CDV1` headers, 1 classroom recording reference, 1 external StudyMaterial reference.
- Owner's safe SSH existence-only check returned `VAULT_KEY_ENTRY=PRESENT_NONEMPTY` for an API-only protected local file; this is NOT key continuity, independently verified provenance or a valid GCM decrypt.
- PR #299 previously passed exact-head CI for offline cryptographic functions with synthetic key/data; actual private key had not been accessed.

## Safe transfer strategy

`scripts/schoolos-v5-private-dpapi-vault-custody.py` runs ONLY on owner's Windows computer in the restricted protected recovery workspace. It validates BitLocker, checks exact known checkpoint and local path, applies an owner-SID ACL, then uses a strict-host-key-check SSH connection to the already-known V5 staging VPS to execute a **single read-only** Python parser on `/etc/schoolos/v5-staging/app-v5-api.env`. The parser reads the **one exact `COMMERCIAL_DOCUMENT_ENCRYPTION_KEY` entry only**. It never writes on server, touches database, imports containers, restarts a service, or reads PostgreSQL, Redis, Razorpay, AI or media credentials. The key traverses a pinned SSH channel privately into owner-local memory and is immediately encrypted using Windows **DPAPI (CurrentUser)**. The only persisted key is the encrypted `protected-escrow/original-vault-key.dpapi` under the existing access-controlled BitLocker folder. It never appears in command-line arguments, environment variables, SSH logs, terminal, GitHub, or reports. It cannot overwrite a previous escrow.

**This is a new security-controlled extraction of one staging secret.** It must be treated as owner authorization to establish local custody, not independent proof that the server was uncompromised. The encrypted DPAPI escrow is bound to the owner's **Windows user account and machine**; it does not constitute an offsite portable/independently witnessed disaster-recovery backup. Continue a separate protected original-key escrow/signoff workflow after the image-history incident is contained.

## Actual offline authenticated decrypt

`scripts/schoolos-v5-vault-private-readback.py` consumes the already-copied local checkpoint and existing `original-vault-key.dpapi`, decrypts the DPAPI secret **only in local process memory**, passes it with the single encrypted Vault record to a local Node AES-256-GCM checker over process stdin (never an argv/env parameter or persisted file). It uses disposable Windows Docker Desktop local `desktop-linux` PostgreSQL 16, cached image, `--network none`, read-only checkpoint bind and tmpfs-only DB, restores schema without data and the single Vault table's rows, authenticates stored CDV1 IV/tag and the **original document SHA-256/byte count**, then erases temporary buffers and checks disposable DB cleanup. Neither decrypted document nor original key is printed or saved. No staging DB/API, Coolify, R2, Razorpay, email, AI or media provider is accessed.

## Owner actions — DO NOT START until exact-head CI SUCCESS

1. Identify the ONE prior protected workspace under `%LOCALAPPDATA%\SchoolOS-V5-Recovery-*` with checkpoint `20261031T073407Z`; confirm C: BitLocker On and recovery-key backup.
2. Clone/pin the exact approved Draft PR #301 source in a new child `vault-dpapi-source` folder; never copy real data into the Git checkout.
3. Run `py -3 -B scripts/schoolos-v5-private-dpapi-vault-custody.py --workspace <private-workspace> --acquire-vault-key --acknowledge-protected-readonly-transfer`. Provide the server SSH password when prompted. The result must be `VAULT_KEY_CUSTODY=PASS_LOCAL_USER_DPAPI` and `VAULT_INDEPENDENT_OFFSITE_ESCROW=NOT_ATTESTED`. If it fails, do not paste error logs, secret values or raw file contents into chat.
4. Run `py -3 -B scripts/schoolos-v5-vault-private-readback.py --checkpoint-dir <private-checkpoint> --checkpoint-id 20261031T073407Z --escrow-key-file <private-workspace>\protected-escrow\original-vault-key.dpapi --report <new-private-report.json> --acknowledge-private-offline-checkpoint`. Result `VAULT_OFFLINE_AUTHENTICATED_READBACK=PASS` proves **that same key** authenticates the encrypted document's GCM tag and plaintext SHA256. A CHECK_REQUIRED result requires scoped technical review and never warrants guessing/generating a new key.
5. Record only sanitized status, source SHA, UTC owner execution date and restricted protected report reference in Issues #292/#258. Never upload the DPAPI file, backup, decrypted PDF, screenshots of credentials, original key, hashes of low-entropy credentials, or raw stdout/stderr.

## Security incident #293 still not cleared

- Original Web image history contained PostgreSQL/Redis build arguments. Existing archive copies and registry viewers must be restricted. This workflow **does not clean old images or revoke leaked DB/Redis credentials**.
- Metadata scans of clean CI-built images and archived owner image configs can identify exposed variable names without revealing values, but are not a full layer scan or signed provenance.
- A coordinated, human-reviewed staging maintenance window, password rotation and source-pinned API/Web/backup rollback pair remain mandatory. Phase 2 owns shared staging; no deployments or service restarts are authorized here.
- An actual Vault document decrypt would advance RC-06 only. Classroom R2 and StudyMaterial external object recovery, RPO/RTO, operational witness and formal release gates remain HOLD.
