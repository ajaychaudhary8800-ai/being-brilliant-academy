# SchoolOS V5 launch approval packet — 29 October 2026

**Decision: HOLD. Prepared for review; not signed acceptance.**
Application candidate: `c8c80151b6f0919552d60c5cb71af1b92d319ff5`.
Development #262 remains draft at that SHA. Release tracking #278 remains draft.
This packet and recovery utility do not change deployed application source.

## Ten-gate register

All ten formal statuses remain PENDING (HOLD). No reviewer identity or signature is supplied by this packet.

| Gate | Evidence carried forward | Specific missing acceptance |
| --- | --- | --- |
| 1. Integration | Current GitHub #262 head matches candidate; #276 integrated | Attributed dependency and build provenance review |
| 2. CI | Existing four exact-source successful runs 40549283311 / 40549283373 / 40549283315 / 40549283325; not rerun | Independent CI/build acceptance |
| 3. Migration/recovery | Operator: 114 applied, zero unresolved; downloaded backup 20261028T020001Z and both checksums PASS | Restore PASS now operator-reported (see update below); independent acceptance, empty-upload scope and Vault/key recovery remain |
| 4. Subscription/payments | Owner-confirmed Razorpay TEST completion | Existing artifact mapping for contract, capture, replay/forgery, refunds, disputes, renewal and ledger; finance acceptance |
| 5. AI/video | Owner-confirmed classroom, recording, LMS playback; AI Examiner evidence from V4 | Attributed provider review and material V4-to-V5 delta coverage |
| 6. Security/privacy | #275 latest comment records isolation, replacement authentication/runtime matches and owner-confirmed revocations | Independent review, historical exposure disposition, tenant/privacy/load scope |
| 7. Customer UAT | Owner functional QA retained | External customer sponsor acceptance, school/coaching and role coverage, onboarding handover |
| 8. Operations | Backup health-script evidence; existing monitoring/support/rollback documents | V5-specific monitor activation and delivered alert, named duty cover, #240 disposition, independent recovery acceptance/key recovery, rollback digests |
| 9. Commercial/legal | Approved pricing reference below | Current accepted pricebook evidence, onboarding/pilot terms, legal/privacy/DPA/tax and finance signatures |
| 10. Production owner | No production GO | Separate explicit approval after gates 1–9 and exact cutover packet completion |

Formal validator run against the current #278 manifest: HOLD, 0/10 VERIFIED, zero validation errors.
Planning estimate: unchanged 80% complete / 20% remaining. Not a measured gate score.

## Recovery utility review and execution handoff

Original: `schoolos_v5_isolated_restore_20261028.py`.
Reviewed replacement: `scripts/schoolos_v5_isolated_restore_20261029.py`.

The original bound a host backup directory into a postgres-user container; restrictive host directory permissions could prevent pg_restore from reading it. It left restored uploads behind and checked migration counts without full restored data readback.

Replacement:
- Reuses the exact existing downloaded backup; no download or backup-checksum repetition.
- Reads only the live V5 container image identifier; never connects to a live database.
- Uses a random labelled, network-none container with no published ports or host/volume mounts; database stays in bounded tmpfs.
- Streams the protected dump through stdin without changing host permissions.
- Caps memory, swap, CPU and process count; checks temporary headroom.
- Checks 114/0 migrations, invalid indexes, application table presence, complete pg_dump readback and pg_amcheck.
- Rejects archive traversal, links, device entries, duplicate normalized paths and excessive extraction size; compares extracted bytes to archive streams.
- Cleans labelled disposable container and extracted temporary files independently; never removes Docker volumes or original downloads.
- Emits aggregate counts/timing only. Final PASS requires cleanup success.

Local validation: Python compilation PASS; four archive/digest unit tests PASS (including unsafe entry subcases). **Initial local validation did not execute Docker/VPS; operator subsequently executed the script successfully (see update below).** pg_amcheck must exist in the existing PostgreSQL image; missing utilities or tmpfs capacity failure are FAIL, not grounds to weaken checks.
If stopped by SIGKILL or host loss, finally cannot run: operator must inspect only the unique recovery-labelled container and its temporary extraction directory before removal. Never use volume prune.

Execution dependency: this session's SSH connection to the supplied VPS IP returned “Network is unreachable”; Cloud Browser inventory contained no existing tabs or authenticated infrastructure session. The owner subsequently executed the utility through their VPS terminal; assistant infrastructure access remains unavailable.
After copying the reviewed utility to the VPS, execute:
```sh
python3 /root/schoolos_v5_isolated_restore_20261029.py
```
Retain sanitized output, UTC start/end, script commit, backup identifier, exit status and independent reviewer identity. Do not mark success from local unit tests.
Recovery duration measures this already-downloaded restore rehearsal, not end-to-end disaster RTO; download/provisioning/key acquisition and customer validation are excluded. Backup age alone is not measured achieved RPO. Vault encrypted-document/key recovery remains separate.

## Security and incident disposition

#275: operational remediation completed on operator evidence; independent security acceptance outstanding. Do not rotate again or close solely from this packet.

#240: unresolved recurrent external transport/browser timeouts, including 23 and 27 October. Existing fail-closed diagnostics and DOM-ready navigation mitigation do not establish cause. Disposition: **OPEN / operations release HOLD**, not silently waived.
Required evidence: correlate failure UTC windows from runs 39916966876, 39919943377, 39944051108 and 40486963071 with origin proxy/container restarts, DNS/TLS path and any edge WAF/rate-limit events. Record evidence unavailable due to retention if applicable. If cause cannot be recovered, an accountable operations reviewer must explicitly accept residual risk with observation window, alert routing, recurrence action and review date; no such acceptance exists here.

## Monitoring, support and recovery readiness

Directly fetched candidate `.github/workflows/uptime-monitor.yml` targets `beingbrilliantedu.com` and `main-staging.beingbrilliantedu.com`; **it does not target V5 staging**. Existing external V5 QA is not proof of continuous monitoring.
Prepare a V5-only monitor in the authorized operations platform targeting homepage, ready and operational endpoints. Require exact HTTPS target, bounded connect/response time, redacted failures, persistent incident and human notification. Prove alert delivery using an isolated synthetic monitor test; do not cause a live outage. GitHub scheduled workflows on a non-default draft branch are not evidence of an active schedule. Do not alter main to activate monitoring in this task.

Existing support policy documents 99.5% availability objective, P1/P2 response of 2/4 business hours, Mon–Sat 09:00–18:00 IST and critical escalation. Those document statements do not prove staffed coverage or delivered messages. Confirm published contact ownership, primary/backup duty persons, escalation availability and actual delivery before contractual reliance.
Confirm offsite retention and independently recoverable backup/Vault keys without revealing values. Do not present a generic production-path restore claim as this V5 backup's completed recovery.

## Commercial reconciliation

| Item | Approved planning reference | Closure needed |
| --- | --- | --- |
| Essentials annual | INR 49,900 | Accepted current pricebook evidence |
| Growth annual | INR 99,900 | Prior reports differ (99,990 versus aligned 99,900); retrieve accepted dated preflight before any correction |
| Professional annual | INR 149,990 | Accepted current pricebook evidence |
| Enterprise | Custom quotation | Approved scope and quotation |
| Pilot | 60 days, INR 14,999 + applicable GST | Inclusions, caps, refund/exit and annual conversion terms |
| Onboarding | Referenced 9,999 / 14,999 / 24,999 | Resolve included-standard-onboarding versus separately charged implementation |

Do not alter existing quotations/invoices or issue binding offers from planning references.
No current signed customer UAT, legal or finance approval was supplied or located in the reviewed GitHub evidence. A targeted file search surfaced historical handoffs, not a signed acceptance document; this is not proof none exists.
Required reviewers: actual customer sponsor; finance accountable person; legal/privacy reviewer; operations and security reviewers. Record actual identity, role, date, scope, candidate SHA, artifact reference/hash, exceptions and decision. Do not prefill PASS or sign on anyone's behalf.

## Production cutover and rollback — prepared, not executable approval

Before GO, complete these concrete blanks: approved production topology/project and domain; immutable V5 API/Web image digests; currently deployed V4 rollback digests and configuration reference; full V4-to-candidate migration delta and compatibility decision; backup ID and Vault/key recovery proof; maintenance window; release commander, operations/finance/support owners; monitoring/alert proof; customer communication approval. None is inferred from staging tags.

Sequence after separate explicit production authorization only:
1. Pin reviewed release and immutable images; verify gates 1–9 and owner GO without relaxing validator.
2. Confirm no intervening code/config drift; take approved production checkpoint and verify its independent restore readiness.
3. Apply reviewed writer-freeze/maintenance plan if migrations require it; preserve queued callbacks and uploads.
4. Execute approved migration/deployment plan in the explicitly named production target; do not reuse staging database/volumes.
5. Validate migration completion, ready/operational health, login, tenant isolation and one representative workflow; verify background workers and backup monitor.
6. Keep live payments and paid-video flags OFF unless separately authorized; production deployment approval alone does not enable them.
7. Observe the agreed window and obtain operator handover; communicate only through separately authorized channels.

Abort/rollback: any tenant leakage, data-integrity failure, failed migrations/readiness or broad login failure triggers incident command and write freeze. Preserve evidence. Application-only rollback is allowed only when DB backward compatibility is established. Otherwise restore a coordinated database+uploads checkpoint into an isolated target, validate, then switch only under explicit recovery authorization. Never blindly run old images over incompatible migrations. Preserve failed state and reconcile external callbacks/payments before resuming writers.
No immutable production rollback identifiers have been independently collected in this session; rollback readiness remains HOLD.

## Operator recovery result — 29 October 2026

Ajay supplied terminal output from `root@srv1880999` executing `python3 /root/schoolos_v5_isolated_restore_20261029.py`. This is operator-supplied runtime evidence, not an independently observed execution or signed gate review. Intended backup: `20261028T020001Z` in the already-verified download directory. No repeat download or checksum run requested.

```text
OFFSITE_DATABASE_RESTORE=PASS
RESTORED_MIGRATIONS=114
RESTORED_UNRESOLVED_MIGRATIONS=0
DATABASE_READBACK=PASS
DATABASE_AMCHECK=PASS
INVALID_INDEXES=0
RESTORED_PUBLIC_TABLES=336
OFFSITE_UPLOADS_RESTORE=PASS
RESTORED_FILE_COUNT=0
RESTORED_FILE_BYTES=0
RECOVERY_DATA_SECONDS=8.9
TEMPORARY_RESOURCES_CLEANED=YES
RESTORE_TOTAL_SECONDS=9.3
RESTORE_TEST=PASS
LIVE_DATABASE_CONNECTIONS=NONE
EXISTING_VOLUMES_CHANGED=NO
CREDENTIAL_VALUES_PRINTED=NO
```

This closes the pending execution of this isolated database/empty-uploads recovery rehearsal. Do not rerun it solely for signoff. 9.3 seconds is local rehearsal elapsed time, not contractual or end-to-end disaster RTO. Zero files means empty-archive handling passed; no nonempty uploads, encrypted Vault documents or external LiveKit recordings were restored by this run. The output does not establish whether those separate stores should contain data; reconcile storage scope before claiming complete document/media recovery.

Remaining for gates 3/8: attributed independent review, separate Vault/key and recording-storage recovery scope, monitoring/alert delivery, retention, incident #240 disposition and immutable rollback references. All ten formal statuses remain PENDING/HOLD; no approvals invented. Planning estimate stays 80% because no calibrated weighting supports a numerical increase.

## External monitor evidence update — 29 October 2026

The owner subsequently provided a HetrixTools screenshot for `SchoolOS V5 Readiness`: **Online**, externally monitored since 29 October 2026, one-minute interval, 10-second timeout, 446.07 ms recent average load and 100% uptime over the monitor's short life (22 minutes online at capture). VPS curl returned readiness HTTP 200, certificate verification code 0 (valid), 0.182195-second total. These are operator-supplied observations; earlier off-host slow samples and unresolved historical #240 are not erased. Full audit: `docs/SCHOOLOS_V5_MONITOR_ACCEPTANCE_20261029.md`.

**Gate 8 adjustment:** External V5 readiness monitoring is evidenced **active**; setup need not be repeated. Still missing confirmed HetrixTools notification contact and received test alert (Coolify Telegram is separate), worker/operational checks, responsible responders and accountable #240 disposition. Keep gate 8 PENDING, overall 0/10 independently signed VERIFIED and production HOLD. No live outage test or redeployment is authorized by this evidence.
