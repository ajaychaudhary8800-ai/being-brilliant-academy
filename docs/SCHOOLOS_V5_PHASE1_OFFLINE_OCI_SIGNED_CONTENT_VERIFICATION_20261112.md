# SchoolOS V5 — owner-local offline OCI rollback manifest verification

**Scope:** draft **Phase 1 / P0 #292** control. The script `scripts/schoolos-v5-private-oci-offline-verify.py` is an additional **independent content-integrity step**. It does not publish, upload, download or run images. Source-only CI tests contain only synthetic OCI TAR archives and throwaway RSA signing keys. No owner image, manifest, private key, R2 credential, volume, or backup has been accessed by the code authoring process.

## Why this step exists

The separate `schoolos-v5-private-r2-signed-readback.py` confirms the authorized signed checksum and full-byte retrieval of two R2 objects, but intentionally **does not** verify that the declared `ociManifestDigest` corresponds to the real OCI image manifest inside each object. Two unrelated SHA-256 domains must never be confused:

- `api.sha256` / `web.sha256`: checksum of **every byte** of the OCI TAR file.
- `ociManifestDigest`: checksum of the **actual OCI image manifest blob** in the TAR (not the local Docker config ID, image label, or archive checksum).

The new verifier checks a separately reviewed/pinned RSA/ECDSA detached signature over the already-established manifest schema `schoolos-v5-private-rollback-readback-v1`, scans each full **owner-private local OCI image-layout TAR** without extracting it, verifies the two actual blob-named image manifests against the signed `ociManifestDigest` values, hashes all OCI blobs against content-addressed blob paths, checks referenced manifest/config/layer descriptors and source-revision label, recomputes each **uncompressed layer DiffID** using a memory-bounded streaming decoder (plain TAR and gzip), and hashes full TAR bytes against signed `sha256`/size. Both images must be Linux/amd64 and from one reviewed, distinct rollback source revision. The verifier requires an exact **single-image index and closed set of referenced blobs** per API/Web role. Any additional/unreferenced SHA-addressed blob or OCI index entry, malformed/extra archive member, symlink, duplicate TAR entry, missing blob, altered content, truncated/incorrectly signed gzip stream, mismatched uncompressed DiffID, bad signature or unrecognized media type gives HOLD without printing archive contents or paths. **Zstd-compressed OCI layers fail closed** until an independently reviewed decoder is implemented. Tar streams are bounded by eight-GiB input files, capped member count and bounded in-memory metadata.

### Required private inputs (owner-controlled local Linux environment)

Use a **trusted offline Linux** workstation. Safely inject these environment variables through a protected owner-held process environment; **never paste the values or material into chat, GitHub Actions, issues or PR attachments**:

```text
V5_CUSTODY_MANIFEST_PATH
V5_CUSTODY_SIGNATURE_PATH
V5_CUSTODY_PUBKEY_PATH
V5_CUSTODY_PUBKEY_SHA256
V5_CUSTODY_API_OCI_ARCHIVE_PATH
V5_CUSTODY_WEB_OCI_ARCHIVE_PATH
```

The first four are the same protected file inputs and independently approved signing-key pin used by the private signed R2 readback script. The last two point to **privately retrieved, clean, verified OCI image-layout TARs** (not historically exposed Docker archives). The signed `sourceSha` is the historical V5 source commit for both rollback images.

After owner-side secure provisioning, run from the reviewed repository checkout:

```bash
python3 scripts/schoolos-v5-private-oci-offline-verify.py
```

Only `V5_ROLLBACK_LOCAL_OCI_CONTENT_VERIFICATION=PASS_LOCAL_SIGNED_ARCHIVES_OCI_DIGESTS` indicates that both protected local TARs match all the declared checks. Anything else returns nonzero / HOLD.

**OCI TAR format:** use a reviewed image-layout OCI exporter; Docker Buildx `--output type=oci` produces this format. `docker save` may instead produce a Docker archive and this utility intentionally refuses non-OCI image layouts. Never convert or republish the old secret-bearing archive (#293) as a shortcut. The correct clean builder, source, attestations and digest signatures must be independently vetted before publication.

## What this does NOT establish

1. A signed custody JSON authenticates a declaration from its signer but **does not establish an independent SLSA/Sigstore/source-to-build attestation**, builder identity or an OCI registry/manifest signature. This script checks digest **content consistency** only; do not call it a signed OCI provenance certificate.
2. Independent publisher/reader permissions, restricted object visibility, effective immutable >=90-day R2 lock, and complete remote readback remain separate requirements of #292.
3. It verifies plain and gzip layer *DiffID byte integrity* but does not assess whether the uncompressed layer is semantically safe, verify every tar member within a rootfs layer, prove image vulnerability/secret scan results, import an image or boot the previous API+Web in a sandbox.
4. It does not prove real-checkpoint app/DB/files/Vault/media recovery or tenant/privacy testing. Historical PostgreSQL and Redis passwords in old build histories remain unrotated under #293.
5. No new signoff, release-gate PASS or owner launch GO is produced; `DEPLOYMENT_AUTHORIZATION=HOLD`.

The 24 synthetic security tests in `scripts/test_schoolos_v5_private_oci_offline_verify.py` cover a valid pair, tampered/incorrectly signed manifest, local archive byte mismatch, false OCI manifest digest, incorrect source revision, corrupted or missing layer, unsafe TAR path, duplicate index, extra file, wrong platform, non-OCI Docker-save-like input, symlink and unapproved signing key; plus valid gzip DiffID, false plain/gzip DiffIDs, trailing gzip bytes, gzip CRC corruption, unsupported zstd, extra unreferenced OCI blob and extra index image; accepts only the standard OCI `blobs/` and `blobs/sha256/` directory entries and rejects unrelated directory entries.

Refs: Issue #258, #281, #292, #293; prior readback Draft #323; existing release-review Draft #330. OCI layout specification: https://specs.opencontainers.org/image-spec/image-layout/ ; Docker OCI exporter: https://docs.docker.com/build/exporters/.
