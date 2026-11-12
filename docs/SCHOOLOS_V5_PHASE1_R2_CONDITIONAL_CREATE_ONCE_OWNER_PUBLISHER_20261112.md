# SchoolOS V5 Phase 1 — Protected private R2 conditional create-once publisher

**12 November 2026. Source-only implementation; never executed against owner Cloudflare. Production/staging authorization HOLD.** This control intentionally leaves an irreversible R2 write **disabled by default**. It cannot certify real historic image cleanliness, independent builder provenance, operator permissions, recovery compatibility or historic credential invalidation.

## Why this exists

Owner-run source-pinned Docker inventory scanned 40 images and found **zero qualifying prior API+Web same-revision cached pairs**; 2 unlabelled API and 9 unlabelled Web remain untrusted and are explicitly barred from reuse following historic PostgreSQL/Redis image-layer secret exposure (#293).

PR #333 rebuilt fresh prior V5 API and Web OCI candidates on disposable private CI and passed actual OCI integrity and bounded layer-pattern scans. However, **both OCI archives were destroyed by CI and have never been preserved in permanent private owner custody**. PR #334 prepared an owner-only pinned local byte-statement signer; PR #335 prepared read-only private configuration, detached-signature/OCI validation and independent target-key HEAD checks. Neither tool has used real owner signing keys or retained private image archives.

This PR adds **the next possible owner-controlled operation** only: conditional, no-overwrite publication of **two newly retained, independently reviewed, signed previous-source OCI TARs** to the already configured private R2 bucket.

## Security-first execution design

`scripts/schoolos-v5-private-r2-conditional-once-publish.py` is non-functional unless invoked with a reviewed *explicit* CLI switch `--execute-owner-approved-write` and private owner consent. Importing it or invoking without the switch causes **no network action** and exits 2. It categorically refuses `CI=true` or `GITHUB_ACTIONS=true`.

Only when the owner separately authorizes an actual 90-day retention event, it:

1. Uses the already-reviewed #335 local strict prepublication checks: verify **entire local OCI TAR contents and signed bytes** with pinned public key, source SHA, OCI layers/config/rootfs DiffIDs. Independently checks the private signed manifest SHA-256 against `V5_CUSTODY_OWNER_APPROVED_MANIFEST_SHA256` and an explicit owner acknowledgement exact value `I_AUTHORIZE_TWO_90_DAY_LOCKED_V5_ROLLBACK_OCI_OBJECTS`. Both conditions must be provided in a protected process environment; no value is read from chat or GitHub variables.
2. Verifies writer/reader key IDs differ, fresh Cloudflare read-only private bucket/no public domains/90-day `v5-rollback/` retention rule and reader-only HEAD absence of **both** signed planned keys.
3. Creates writer S3 SigV4 client from **private owner local writer credentials**. Only supports a single `PutObject` for each signed OCI archive **up to 5 GiB**. Larger objects fail closed; the implementation does not blindly use `upload_file` or unsafe multipart fallback.
4. Uses `IfNoneMatch="*"` **atomically on each PutObject**, with ContentLength and fixed content-type. Includes a **new UUID write-id** and signed archive SHA in custom metadata to help the owner independently reconcile uncertain outcomes. File is opened `O_NOFOLLOW` and checked for regular-file type, exact signed length and non-world/group-writable permissions. The exact open file descriptor is fully SHA256-rehashed just before each PUT and reset to byte zero; in-flight mutation is still detected only at independent reader readback. Boto3 SDK automatic retries are disabled; a connection error may nevertheless represent a committed write, and is never automatically retried.
5. After both PutObject responses return 200, the **independent reader identity** executes a full-body HEAD+GET streaming SHA-256 readback against signed archive checksum, size and exact keys using the existing #331 readback verifier.
6. No upload is followed by a deletion, overwrite, forced retry, object rekey, live Docker operation, staging/production mutation, Cloudflare lock change or credential rotation. An error after the first upload is **PARTIAL OR UNKNOWN IMMUTABLE CUSTODY**, requiring out-of-band incident-safe reconciliation by operator; it is never treated as zero objects. Any reader mismatch leaves retention in place and hard HOLD.

Custom metadata can help identify an operator's write, but AWS/R2 ETag is **not an acceptable full SHA-256 integrity substitute**. Reader HEAD 404 before upload is not an atomic assurance; only create-once `If-None-Match: *` on the *commit request* prevents overwrite races. Cloudflare docs explicitly support conditional `PutObject`, including 412 precondition failures and 409 locked-object failures. References:
- https://developers.cloudflare.com/r2/api/s3/conditional-operations/
- https://developers.cloudflare.com/r2/buckets/bucket-locks/
- https://developers.cloudflare.com/r2/reference/consistency/

**Very important:** Even if this tool ever returns `PASS_TWO_CONDITIONAL_PUTS_AND_INDEPENDENT_READER_FULL_SHA256`, the *actual* lock object-level overwrite/delete denial, independent builder/source attestation, full semantic secret clearance, authorized writer-minimum/reader-deny-write permission testing, genuine restored app/DB/files/Vault/media compatibility and #293 historic credential invalidation must still be individually verified. No formal #258 launch gate automatically closes. Only the owner can grant actual irreversible object-write approval under a documented separate change window.

## Input boundaries

Requires the full protected owner-only #335 environment (Cloudflare Admin Read Only API token, signing-public-key pin, signed custody receipt, two local newly rebuilt and independently reviewed OCI TARs, distinct narrow reader/writer S3 identities). Additional confidential **operator-local** variables include `R2_CUSTODY_WRITER_SECRET_ACCESS_KEY`, `V5_CUSTODY_OWNER_IMMUTABLE_UPLOAD_ACK` and `V5_CUSTODY_OWNER_APPROVED_MANIFEST_SHA256`. **Do not paste credentials, file paths, signing keys or actual OCI metadata into a GitHub issue or chat.** No action should be taken until actual retained signed archives, policy authorizations and reviewer evidence exist.

## Synthetic tests

`scripts/test_schoolos_v5_private_r2_conditional_once_publish.py` contains 23 synthetic positive/negative tests. They use fake `PutObject` and independent-reader mocks, temporary synthetic byte strings and fully fake manifest objects, testing:
- disabled-by-default and missing approval;
- wrong manifest fingerprint and CI refusal;
- local signature or R2 config/identity verification failing *before* any network write;
- exact two atomic IfNoneMatch operations and independent readback;
- symlink/writable source rejection and 5 GiB size cap;
- ambiguous first/second write or reader error hard HOLD **without retry/delete**, with only sanitized error codes.
No test calls Cloudflare or writes any actual R2 object.

The previously demonstrated R2 config preflight is `PASS_CONFIGURATION_ONLY`; actual long-lived signed immutable OCI object custody still absent. Maintain #281/#292/#293 OPEN, #258 0/10 VERIFIED, `COMMERCIAL_GO=HOLD` and `DEPLOYMENT_AUTHORIZATION=HOLD`.
