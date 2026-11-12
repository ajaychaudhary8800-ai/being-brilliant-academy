# SchoolOS V5 — Offline owner-only signed previous-image byte statement

**Phase 1 P0 #292; 12 November 2026. Status: development-only control, NOT recovery readiness.**

The previous V5 API/Web cached-image inventory is complete and shows **zero** eligible matching old API/Web labelled pairs (40 images, 2 unlabelled possible API and 9 unlabelled possible Web). Never copy previous compromised images from staging (#293) into this signing workflow. Instead, use independently built and independently reviewed **new** OCI archives from immutable prior source `b54dca5ae36a948f83012faa4a37354198fba083`.

Previously validated PR #333 built **real** prior-source API/Web OCI image-layout TARs in disposable CI, verified full OCI digests/source labels, checked fixed sensitive-name assignments and bounded filesystem private-key/path/CI-canary patterns, and discarded both TARs at the end of the run. **Those images do not presently exist in permanent custody and cannot be signed, recovered or used to rotate credentials.** A future trusted, approved builder must create fresh private copies after complete independent metadata/rootfs, build-provenance, origin/recipe-delta and image execution review. Do not upload real OCI TARs, private signing keys, manifests, unredacted metadata or credentials to GitHub, chat, email or public Actions artifacts.

## New exact-source owner-local helper (no network)

`scripts/schoolos-v5-private-custody-offline-sign.py` consumes only the owner's private local environment on a **trusted Linux machine** and produces a signed **byte-description** for the previously reviewed OCI API/Web candidate pair. The script never accesses Docker, R2, VPS, databases, Vault, Coolify or production. It requires these **privately injected** environment variables (do not paste values, paths or file content into chat/CI logs):

- `V5_CUSTODY_API_OCI_ARCHIVE_PATH` and `V5_CUSTODY_WEB_OCI_ARCHIVE_PATH`: authorized clean, newly rebuilt local OCI archives (not previously leaked Docker-save archives).
- `V5_CUSTODY_PRIVATE_SIGNING_KEY_PATH`: owner-controlled **unencrypted** private RSA/ECDSA PEM file with owner-only permission 0600 in a protected, independently approved signing environment. The tool deliberately does NOT generate, rotate or upload a key. If existing security policy prohibits unencrypted private keys at rest, **do not use this helper without an approved secure signing adapter/HSM**.
- `V5_CUSTODY_PUBKEY_PATH` and `V5_CUSTODY_PUBKEY_SHA256`: independently recorded owner-approved pinned public PEM bytes and their **64-character lowercase SHA-256** pin. Do not infer trust from a public key or digest that was merely generated alongside the private key.
- `V5_CUSTODY_SIGNED_OUTPUT_DIR`: pre-existing, owner-owned, private Linux directory mode **0700**, in encrypted or otherwise authorized owner-only storage.

Invocation after input review:

```bash
python3 scripts/schoolos-v5-private-custody-offline-sign.py
```

The tool first recomputes the signed-receipt schema data using the existing strict two-archive candidate checker (full file SHA-256 and length, OCI manifest/config/layer hashes and DiffIDs, single-image source SHA and Linux/amd64, selected forbidden sensitive assignments in config/history/labels). It **does not certify complete semantic secret clearance**. It verifies the pinned public key's exact bytes, rejects unsafe/mismatched private keys, signs the canonical JSON using OpenSSL with a short-lived in-memory file descriptor and suppressed error/log output, self-verifies the detached signature via the *existing independent readback verifier*, then writes exactly:

```text
v5-rollback-custody.json
v5-rollback-custody.sig
```

Both outputs are **new files only** (`O_EXCL|O_NOFOLLOW`), private mode 0600, never overwritten. The manifest uses the exact existing `schoolos-v5-private-rollback-readback-v1` schema and expected R2 keys `v5-rollback/<sourceSha>/{api,web}.oci.tar`. It is only a **signed local checksum statement**, **NOT** OCI or Sigstore provenance. Do not set any release gate PASS based on it.

The helper fails closed for wrong public-key pins, unexpected private/public key pairing, world-readable signing keys/output directory, symlinks, existing output files, invalid OCI archives, wrong historical revisions, duplicate API/Web bytes, missing OpenSSL or Linux `memfd_create`, or signature-verification failure. It prints only fixed status codes. It cannot contact R2, generate real credentials, read real backups, export images or authorize deployment.

## Evidence and remaining controls

- Synthetic-only tests in `scripts/test_schoolos_v5_private_custody_offline_sign.py` generate throwaway **RSA** keys and synthetic OCI image-layout TARs in a temporary 0700 directory. They verify positive pinned signing, exact existing signature-readback interoperability, no-overwrite, bad key/pin/permissions/symlink/OCI rejection and tampering detection. Tests do **not** use or create real owner key material or any live OCI images.
- Private signer identity, independently **validated** previous source-to-build attestation and complete clean rootfs assessment are separate gates. A single owner private signature does not attest the actual builder, source dependencies or image cleanliness.
- The verified R2 90-day `v5-rollback/` bucket lock is **configuration-only**. The real publisher/reader credential boundaries, actual object-level private locked write and independent full-byte signed retrieval are still unverified. Do not write irreversible R2 locked objects without complete approval.
- Real isolated restored checkpoint application **API/Web + DB/files/Vault/media** compatibility and #293 historical PostgreSQL/Redis password invalidation are not done. Keep #281, #292, #293 OPEN, #258 at **0/10** formal launch gates, and `DEPLOYMENT_AUTHORIZATION=HOLD` / `COMMERCIAL_GO=HOLD`.

**No user action required to run this now.** Real input archives do not exist in protected custody, so this helper is source-only pending separately approved private build and keys.
