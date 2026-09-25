# Production Incident Response Runbook

Use this runbook for Being Brilliant ERP + LMS + CRM production incidents.

## 1. Severity

### P1 — Critical

Examples:
- production homepage/API unavailable;
- database or Redis unavailable;
- confirmed or suspected cross-tenant data exposure;
- material security breach;
- material data corruption;
- broad login failure;
- a failed deployment prevents normal platform access.

Immediate priorities: contain, preserve evidence, restore safe service, communicate, then diagnose root cause.

### P2 — High

Examples:
- major contracted module unavailable;
- background worker repeatedly unhealthy;
- backup container unhealthy/stale;
- configured notification provider unavailable;
- persistent elevated 5xx rate or severe latency;
- nightly full-role QA repeatedly fails on a production-relevant workflow.

### P3 — Normal

Examples:
- isolated workflow defect with a safe workaround;
- limited UI problem;
- single-user configuration issue.

## 2. Detection sources

Check:
- open `[monitor] Production health check failing` GitHub issue;
- external monitor workflow;
- `/api/health/ready`;
- `/api/health/operational`;
- `/api/health/integrations`;
- Coolify container state/restarts;
- backup container health;
- structured API logs;
- request ID supplied by the affected user;
- latest deployment/commit;
- nightly staging QA.

## 3. First response

For P1:
1. Stop non-essential production changes.
2. Record incident start time and observable impact.
3. Preserve the monitor run URL, request IDs and relevant logs.
4. Check database and Redis readiness.
5. Check the most recent deployment and whether impact began immediately after it.
6. Check backup freshness before any destructive recovery action.
7. Determine whether the issue is availability, data integrity, security, provider dependency or application regression.
8. Assign one incident owner; avoid multiple people making uncoordinated production changes.

For a suspected tenant-isolation/security incident, prioritize containment and evidence preservation over feature restoration.

## 4. Rollback decision

Rollback when a recent release is strongly correlated with the incident, the previous release is known healthy, rollback is safer than a forward fix, and no migration incompatibility makes rollback unsafe.

Before rollback:
- inspect database migration compatibility;
- preserve logs;
- identify the exact last-known-good commit/tag;
- do not reverse destructive schema changes blindly.

After rollback:
- verify `/health/ready`;
- verify `/health/operational`;
- smoke login and the affected workflow;
- monitor the next external check.

## 5. Database/data incident

Never restore directly over production as an exploratory test.

For suspected corruption:
1. Restrict writes if necessary.
2. Preserve current database state.
3. Verify latest backup/checksums.
4. Restore only into an isolated environment first.
5. Reconcile affected records and incident window.
6. Approve a production recovery plan before changing live data.

Step 5 off-site DR remains a separate dependency.

## 6. Security/tenant-isolation incident

1. Stop the affected access path where practicable.
2. Preserve logs/audit events.
3. Identify tenants/users/routes/time window involved.
4. Rotate compromised credentials/secrets where applicable.
5. Do not delete evidence merely to suppress an alert.
6. Escalate legal/privacy notification assessment using the Step 9 DPA/legal framework.
7. Verify isolation tests before reopening the path.

## 7. Notification/provider incident

Check `/api/health/integrations` and notification metrics/logs.

If a provider is degraded, protect core ERP operation, avoid repeated uncontrolled retries, inspect DEAD_LETTER/FAILED deliveries, and communicate provider-specific impact rather than declaring the entire platform down.

## 8. Backup incident

If the backup container is unhealthy:
1. inspect `.last-failure`, `.last-success` and backup logs;
2. verify disk space;
3. verify database connectivity;
4. verify `SHA256SUMS` for the last known successful backup;
5. if S3/off-site is configured, verify upload errors separately;
6. run a controlled manual backup only after identifying the immediate failure cause.

A healthy local backup does not prove off-site DR.

## 9. Communication

For a material client-impacting incident, communication should state what users are experiencing, when impact began if known, affected scope, workaround if safe, and the next update channel.

Do not speculate about root cause before evidence exists.

## 10. Recovery criteria

Do not close an incident merely because the homepage loads.

For P1/P2, verify as applicable:
- external monitor recovered;
- database/Redis ready;
- background workers healthy;
- affected workflow passes;
- no continuing error spike;
- deployment state known;
- backup state known;
- security containment complete where relevant.

The automated monitor closes only its persistent availability issue. It does not replace human incident closure for security/data incidents.

## 11. Post-incident review

For P1 and material P2 incidents record timeline, customer impact, detection method, root cause, contributing factors, recovery action, why controls did/did not catch it earlier, permanent corrective action, test/monitoring change and owner.

Prefer corrective controls over blame.
