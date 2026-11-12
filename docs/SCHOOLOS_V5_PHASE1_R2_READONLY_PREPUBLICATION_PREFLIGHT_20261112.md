# SchoolOS V5 Phase 1 — Pre-publication R2 custody read-only gate

**12 November 2026. Source-only development in Draft PR. No real R2 writer or reviewer credentials were used. No R2 objects created.**

This narrow pre-publication verifier is designed to reduce risks before the owner considers an irreversible 90-day locked object upload to `schoolos-v5-rollback-custody`. It does **not** publish, authorize a write, verify actual effective writer privileges or prove rollback readiness.

## Requirements verified in a protected operator environment

`scripts/schoolos-v5-private-r2-publication-preflight.py` executes its stages in this fail-closed order:

1. Local private detached-signature verification with the **independently approved pinned public PEM** and exact archive bytes; reuses `schoolos-v5-private-oci-offline-verify.py` and owner custody manifest schema. Each API/Web OCI TAR must match the signed complete checksum/length, the actual referenced OCI manifests and all config/layer blobs/diffIDs, and the approved previous source SHA `b54dca5ae36a948f83012faa4a37354198fba083`. No local signature alone is independent source→binary or semantic secret clearance.
2. Validates separate **writer and reader Access Key IDs** supplied privately. Different ID strings are **not proof of effective IAM permissions**, but reuse of the same key fails immediately.
3. Performs fresh Cloudflare read-only control-plane checks through the previously owner-run `schoolos-v5-r2-custody-preflight.py`: the dedicated private bucket, disabled managed domain, zero custom domains, enabled lock with exact `v5-rollback/` prefix (or bucket-wide) and minimum 90 days.
4. With **only the reader identity**, performs two read-only S3 `HeadObject` calls for *exactly* the two signed planned object keys. A true HTTP 404 `NoSuchKey` / `NotFound` is treated as an observation that the target key is absent at that instant. **403, permission denial, 5xx, malformed responses and present objects are all HOLD.** No fallback to list, unsafe key guessing, uploads, deletion, overwrite, object-copy, multipart or Docker. Object absence is not guaranteed to remain true until upload and does not prove writer privileges.

All input path/key/token/account values arrive privately through environment variables, are never printed, and no remote HTTP/S3 exceptions are logged. The script emits status-only fixed blocker codes and always prints `DEPLOYMENT_AUTHORIZATION=HOLD` and `V5_R2_OBJECTS_CREATED=NO`.

### Environment inputs: **private owner operation only**

Reuses the existing signed archival verifier's local environment names:
`V5_CUSTODY_MANIFEST_PATH`, `V5_CUSTODY_SIGNATURE_PATH`, `V5_CUSTODY_PUBKEY_PATH`, `V5_CUSTODY_PUBKEY_SHA256`, `V5_CUSTODY_API_OCI_ARCHIVE_PATH`, `V5_CUSTODY_WEB_OCI_ARCHIVE_PATH`.

Uses these restricted provider identities (**never paste values into GitHub or chat**):
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Admin Read Only for control plane), `R2_CUSTODY_WRITER_ACCESS_KEY_ID` (**ID only; no writer secret needed**), `R2_CUSTODY_READER_ACCESS_KEY_ID`, and `R2_CUSTODY_READER_SECRET_ACCESS_KEY`. A temporary admin-readonly token used in earlier user check should be revoked after use. No real credentials should be registered in GitHub CI for this test tool.

Example operator invocation **only after two permanently protected CLEAN prior OCI artifacts and an approved signer exist**:

```bash
python3 scripts/schoolos-v5-private-r2-publication-preflight.py
```

### Tests and limitations

`scripts/test_schoolos_v5_private_r2_publication_preflight.py` is 17 synthetic-only tests. It injects fake S3 readers and simulated Cloudflare preflight outcomes, tests 404-vs-403/5xx ambiguity, existing object refusal, identity reuse, read-only calls, and ordering that blocks network before signed OCI proof. No test contacts Cloudflare or executes `PutObject`.

The supporting real Cloudflare documents confirm:
- 90-day bucket locks protect matching objects against deletes and overwrites: https://developers.cloudflare.com/r2/buckets/bucket-locks/
- `If-None-Match: *` on a future authorized `PutObject` or on multipart **completion** is needed to prevent races/overwrites, because negative HEAD checks alone are not sufficient: https://developers.cloudflare.com/r2/api/s3/conditional-operations/

**No irreversible write occurs in this tool**. If an authorized publication mechanism is developed later, it must verify actual publisher permissions, use atomic create-only R2 conditions at commit time, track ambiguous write results, verify object-level retention, and independently re-read every byte with an isolated reader identity; signing a manifest is not equivalent to signing a build or ensuring rollback compatibility.

## Hard stop

The recent #333 CI freshly built and scanned previous source API/Web images **ephemerally and deleted them**. #334 created only an independently pinned owner-offline signed-bytes helper, never used with real owner keys. Neither produces retained private archives. The owner cannot yet successfully run this pre-publication gate with real approved artifacts. No source-only checklist can manufacture them.

**Status:** #292 OPEN, #293 historical PostgreSQL/Redis credentials still unrotated; #281 credential scoping acceptance remains independent. All #258 formal release gates still 0/10 VERIFIED. `COMMERCIAL_GO=HOLD`, `DEPLOYMENT_AUTHORIZATION=HOLD`.
