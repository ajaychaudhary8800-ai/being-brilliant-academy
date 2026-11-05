# SchoolOS V5 — private R2 rollback custody: read-only fail-closed preflight

**Status:** source-only check; no Cloudflare account configuration or images have been modified. This is a subordinate configuration check for #292, **not rollback acceptance** or production GO.

Cloudflare's read-only R2 control-plane endpoints can verify selected properties of the **dedicated bucket** `schoolos-v5-rollback-custody`: existence, lack of a public `r2.dev` domain, lack of custom domains, and an enabled retention lock applying to the designated `v5-rollback/` prefix for at least 90 days (or indefinitely). All four checks must pass before this limited configuration check reports `PASS_CONFIGURATION_ONLY`.

The account owner must create and restrict the bucket using Cloudflare administrative controls; the preflight does **not** create buckets or update locks. **Do not use the existing staging or production backup buckets.** Check current rules before making any lock modifications, because the lock API replaces the rule set.

## Run locally after account-side provisioning

Supply `CLOUDFLARE_ACCOUNT_ID` and a **dedicated Cloudflare API read-only token** using your protected environment; never paste the values in GitHub, PR descriptions, chats, logs or shell history. Do not reuse an R2 S3 object API key as the Cloudflare API bearer token. Use your local secrets manager's protected process injection mechanism.

```powershell
python scripts/schoolos-v5-r2-custody-preflight.py
```

A fully configured bucket produces `R2_PRIVATE_CONFIG_PREFLIGHT=PASS_CONFIGURATION_ONLY`; the exit code is zero **only for those four read-only configuration checks**. Missing credentials, missing properties, public domains, inadequate retention, API failures or unexpected response shapes produce `HOLD` and exit code 2. Outputs contain only finite status labels, never Cloudflare response bodies, tokens, account IDs, object names or manifests.

**Security boundaries:**
- All HTTP calls are `GET`, restricted to four Cloudflare API paths, with bounded responses, a short timeout and redirects disabled. No OCI binary, object or customer data is read or written.
- This check **cannot** prove the API token's full administrative permissions, separate publisher/retriever identity, bucket-scoped S3 permissions, actual object WORM enforcement, signed OCI digests, independent retrieval or real-checkpoint application/DB/files/Vault/media compatibility.
- The tool intentionally prints `DEPLOYMENT_AUTHORIZATION=HOLD` regardless of its result. Use the existing #292 evidence gate and institutional release board for additional independent attestations; never auto-promote from this script.
- The workflow `V5 R2 Rollback Custody Preflight Unit Tests` is **offline synthetic only** and has no Cloudflare keys. It never accesses the real account.

Official control-plane endpoints: `GET /accounts/{account_id}/r2/buckets/{bucket_name}`, `.../domains/managed`, `.../domains/custom`, `.../lock` (Cloudflare R2 API docs). No mutation endpoint is used.
