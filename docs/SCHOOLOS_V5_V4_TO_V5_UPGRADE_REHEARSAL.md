# SchoolOS V5 Stage 7G3 — Frozen V4 to V5 Migration + Recovery Drill

## Engineering objective

Previous green CI runs applied the V5 schema to **fresh** PostgreSQL databases. That does not prove the V4 production schema can be migrated safely, that customer records survive, or that the resulting V5 database can be restored from a backup. This stage adds a separate, isolated **synthetic** GitHub Actions upgrade rehearsal.

### Safe execution boundaries

- Workflow: `.github/workflows/schoolos-v5-upgrade-rehearsal.yml`
- Script: `scripts/schoolos-v5-upgrade-rehearsal.sh`
- Frozen V4 base commit: `50dfdeb4f99c5cdbaf1d5a9502c709fbbf2798f6`
- Runs on a GitHub-hosted Ubuntu job with **temporary local PostgreSQL 16**; no VPS/production credentials, R2 objects, production tenant data, or external payment/AI providers.
- Exits 78 unless it is running inside GitHub Actions against local `127.0.0.1:5432`, the expected local test superuser and the exact frozen V4 commit.
- Creates isolated databases `bba_v4_rehearsal_test`, `bba_v5_rehearsal_test`, and `bba_v5_restored_test`. Refuses to use preexisting databases.

### Acceptance checks

1. Checkout exact frozen V4 revision in a detached read-only worktree.
2. Apply **only the V4 migration history** to the first fresh local database.
3. Insert synthetic organization and platform user rows (no personal or school data).
4. `pg_dump` the V4 database, hash the archive and restore it into a second empty database.
5. Apply **all V5 incremental migrations** from the current candidate to this restored V4 state. Require a higher completed-migration count than at V4 baseline and no unresolved migration failures.
6. Confirm V5 commercial, video/AI credits, provider webhook, and financial review models have physical PostgreSQL tables.
7. Verify synthetic organization and user IDs survived the upgrade.
8. Back up the upgraded V5 database and restore it to a third new database; verify the complete migration count and customer identities.
9. Re-check frozen V4 source migration count and V4 backup SHA to detect accidental source changes.
10. Upload a JSON **AUTOMATED_SYNTHETIC_PASS_NOT_STAGING_ACCEPTANCE** report to GitHub Actions for traceability.

## Coverage limits

The test uses schema-only historical V4 migration history plus two synthetic identities. **It is not** a real backup restore of the customer's V4 server, a live staging migration, financial/provider reconciliation, student PII acceptance, or a signed production promotion authorization. The Version 5 release gate stays HOLD until separately verified real staging QA, payment-provider and LiveKit tests, formal customer acceptance, and commercial/legal approvals.

Do not count an uploaded synthetic artifact as independently signed acceptance evidence. No production deployment, paid-feature activation or merge is permitted by this workflow.
