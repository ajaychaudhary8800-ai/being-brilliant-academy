# SchoolOS V5 — Phase 1 independent private R2 signed archive readback

**Status:** source-only. **No owner R2 bucket, credentials, signed OCI image pair, actual object retrieval, historical PostgreSQL/Redis password rotation, or staging maintenance was performed by this PR.** Release board #258 and security incidents #281/#292/#293 remain HOLD.

## Purpose and strict scope

This script provides **one previously missing independently verifiable step** in private rollback-artifact custody: a second, owner-controlled reader can prove that **both** private R2 archives exist and their **full streamed bytes** match checksums in an **RSA/ECDSA SHA-256 signed** manifest whose signing public key is pinned by a separately approved SHA-256 fingerprint. It cannot mint or sign the source manifest, upload archives, sign OCI manifest digests, validate source provenance, test the application against real checkpoint data, or certify object-lock / access policy. It neither modifies nor reads staging or production containers.

The selected, **separate** private bucket is `schoolos-v5-rollback-custody`; the two immutable object keys must be exactly:

- `v5-rollback/<40-hex-reviewed-source-sha>/api.oci.tar`
- `v5-rollback/<40-hex-reviewed-source-sha>/web.oci.tar`

The `<sourceSha>` must be a **reviewed prior V5 Git revision**, not an unreviewed mutable tag. The script requires an exact `v5-private-rollback-readback-v1`-style manifest schema (the actual marker is `schoolos-v5-private-rollback-readback-v1`) and exactly two role objects. Contents are arbitrary bytes as far as this tool is concerned; a matching `ociManifestDigest` field is **only a signed declaration, not independently verified OCI data**. Do not call this signed OCI provenance.

## Before any actual readback

1. Owner creates and reviews the dedicated Cloudflare R2 bucket (not the backup bucket), disables the `r2.dev` public URL, confirms no public custom domains, establishes an effective >=90-day object lock for `v5-rollback/`, and validates with `scripts/schoolos-v5-r2-custody-preflight.py`. This is a **configuration-only** check.
2. Owner approves **separate** bucket-scoped, non-reused writer and read-only retriever credentials. Privilege separation must be audited independently: merely providing a reader key variable cannot prove it has no write permission. No API key, password, private signing key, image, signed manifest or private backup is posted to GitHub, GitHub Actions, ChatGPT or public assets.
3. Trusted build operator signs and privately retains a **clean**, previously reviewed API+Web OCI archive pair from exact pinned source/recipe. Run full metadata/layer scans before any publication. Do **not** upload the historically exposed legacy Web archive (#293). Publish only after independently verifying private destination and object-lock controls.
4. Signing operator creates a JSON document with exactly the following fields, populated with **actual clean archive** bytes and source metadata:

```json
{
  "schema": "schoolos-v5-private-rollback-readback-v1",
  "sourceSha": "1111111111111111111111111111111111111111",
  "api": {
    "key": "v5-rollback/1111111111111111111111111111111111111111/api.oci.tar",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "sizeBytes": 1,
    "ociManifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "web": {
    "key": "v5-rollback/1111111111111111111111111111111111111111/web.oci.tar",
    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "sizeBytes": 1,
    "ociManifestDigest": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  }
}
```

All values above are **synthetic placeholders**, not valid recovery evidence. Calculate `sha256` from the **full archive** (not Docker image config ID or OCI manifest digest); `sizeBytes` is the exact archive length. A source label or locally stored tar SHA alone cannot establish OCI signature authenticity. Never upload image contents or sensitive log data here.

The signer produces a detached signature over the **exact manifest bytes** using its separately held private key, e.g.:

```bash
openssl dgst -sha256 -sign /protected/signing-private.pem -out /protected/custody.sig /protected/custody.json
sha256sum /protected/custody-public.pem
```

Record the **public key file SHA-256** independently with the authorized security reviewer. Do not let the publisher self-approve an arbitrary replacement public key at verification time. The private signing key never needs to be on the reader's machine.

## Independent READ-ONLY reader (only after private account setup)

The reader has Python 3, OpenSSL, and optional `boto3` installed locally (the CI tests do not need boto3 or real R2). The operator's secret manager injects protected variables, **not chat, GitHub PR secrets, shell history or command-line arguments**:

```text
CLOUDFLARE_ACCOUNT_ID                   = 32-hex Cloudflare account ID
R2_CUSTODY_READER_ACCESS_KEY_ID          = dedicated bucket-scoped read-only S3 key ID
R2_CUSTODY_READER_SECRET_ACCESS_KEY      = matching protected S3 secret
V5_CUSTODY_MANIFEST_PATH                 = protected local signed JSON path
V5_CUSTODY_SIGNATURE_PATH                = protected detached signature path
V5_CUSTODY_PUBKEY_PATH                   = independently reviewed public signing PEM path
V5_CUSTODY_PUBKEY_SHA256                 = independently reviewed lower-case 64-hex public key file digest
```

Then run from a **separate trusted** workstation or isolated runner:

```bash
python3 scripts/schoolos-v5-private-r2-signed-readback.py
```

The tool validates pinned key and manifest signature **before establishing a network client**, then issues only `HeadObject` and `GetObject` S3 operations for the two hardcoded prefix/role keys and streams the entire object into a bounded SHA-256 calculation. It never creates local image archives, writes S3 objects, authenticates to V5 staging or alters any service. It suppresses untrusted remote exception text and never prints private bucket paths/account IDs/keys.

`PRIVATE_R2_TWO_ARCHIVE_READBACK=PASS_FULL_BYTES_SHA256` means only **signed checksum match and successful independent full-stream retrieval**. It does **not** imply public ACL safety, independent writer/reader policy, WORM retention enforcement, validated OCI manifest signatures, clean build provenance, or real checkpoint restore compatibility. All those external prerequisites still require separate, **attributable protected evidence**. Invalid or missing inputs and transport failures yield `HOLD` and nonzero exit. Every outcome prints `DEPLOYMENT_AUTHORIZATION=HOLD`.

## CI scope

`.github/workflows/schoolos-v5-private-r2-readback-tests.yml` exercises synthetic offline RSA signing and fake private R2 objects with no secrets, no Cloudflare connection and no staging changes. The workflow must never receive real R2 credentials, real OCI image binaries or private signer key.

## Next required operations / release gate boundary

1. Owner supplies actual private bucket and protected **independent** reader/writer scopes; verify R2 preflight under a separate trusted read-only control-plane credential.
2. Trusted builder creates and signs the **clean** historical API/Web OCI manifest digests and archives, stores them only in the private bucket; independent reader verifies signatures and full bytes. This script tests archive consistency, **not OCI provenance**.
3. Trusted reviewer performs isolated **real-checkpoint** DB/files/Vault/media application restore with those exact retrieved artifacts and signs compatibility; never equate synthetic current→previous→current boot with real-data rollback acceptance.
4. Only after protected rollback and exclusive Phase 2 staging lock handoff can owner schedule #293 PostgreSQL/Redis credential rotation and old-credential rejection. No unattended rotation. Cross-reference #281 runtime scope and #258 signed gate 6/10.
5. No commercial/production promotion from this source-only tooling. All 10 formal release gates remain PENDING until the accountable original evidence is reviewed.

Official R2 S3 SDK endpoint uses `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` with region `auto`: Cloudflare documentation https://developers.cloudflare.com/r2/get-started/s3/ ; Bucket Lock semantics: https://developers.cloudflare.com/r2/buckets/bucket-locks/.
