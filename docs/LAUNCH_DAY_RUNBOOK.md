# Commercial Launch Day Runbook

Use this after the Step 14 readiness framework reports GO and management has authorized the commercial release.

## T-7 to T-3 days

- Freeze material feature scope.
- Confirm Step 5 off-site DR evidence.
- Confirm legal execution particulars and approved public legal pages.
- Confirm first-client validation where required.
- Confirm no open P1/P2 production incidents.
- Confirm pricing and proposal pack are unchanged.
- Confirm support contacts and escalation ownership.
- Confirm production monitoring and nightly staging QA are green.
- Confirm latest backup and checksum evidence.
- Confirm migration state is current.
- Confirm rollback reference.

## T-24 hours

- Run protected CI on the intended release commit.
- Run `pnpm launch:check`.
- Run `pnpm launch:require-go`.
- Review open repository issues and non-Dependabot pull requests.
- Verify production homepage.
- Verify `/api/health/ready`.
- Verify `/api/health/operational`.
- Verify public demo form.
- Verify privacy/terms/AUP links.
- Verify login and workspace routing.
- Verify subscription/billing configuration.
- Verify platform SaaS Sales workspace.
- Verify latest backup state.

Do not introduce non-critical changes after this checkpoint.

## T-2 hours

- Re-run GO gate.
- Confirm no deployment drift.
- Confirm support owner is reachable.
- Confirm implementation/onboarding owner is reachable.
- Confirm payment/invoicing process.
- Confirm first-client organization and handover record if applicable.
- Confirm monitoring issues are clear.
- Confirm release notes are prepared.

## Final GO / NO-GO

GO requires:

- `pnpm launch:require-go` passes;
- required CI checks pass;
- production health is green;
- no active critical incident;
- legal/public policy gate is complete;
- backup/DR gate is complete;
- management authorizes release.

Any one failed hard gate means NO-GO/HOLD.

## Release execution

1. Identify the exact release commit.
2. Create the approved release tag/version under Step 12.
3. Deploy through the normal controlled production path.
4. Do not manually patch production files outside change control.
5. Wait only for actual deployment completion signals; do not assume success from a queued deployment.
6. Verify database migrations completed.
7. Verify API and web container health.
8. Verify backup container health.
9. Verify production readiness and operational endpoints.
10. Verify login.
11. Verify one representative protected workflow.
12. Verify SaaS Sales/public demo intake.
13. Verify billing/subscription surface.
14. Confirm external monitor recovery/green state.

## First hour

Check:

- homepage/API availability;
- login failures;
- 5xx errors;
- unusual 401/403/429 spikes;
- worker health;
- notification/provider state;
- database/Redis readiness;
- container restarts;
- incoming demo leads;
- support reports.

Do not treat zero support tickets as proof that the release is healthy.

## First 24 hours

- Keep non-critical deployments frozen.
- Review external monitoring.
- Review structured error logs/request IDs.
- Review nightly staging QA.
- Review backup completion.
- Review any client-impacting issue.
- Verify the first paying client’s critical workflows where applicable.
- Record material defects and owners.

## Rollback trigger

Consider rollback when:

- release causes production unavailability;
- broad login/core workflow failure appears;
- material tenant-isolation/security regression appears;
- severe data-integrity regression appears;
- release-correlated 5xx/latency remains unacceptable;
- forward fix is riskier than returning to the last known good release.

Use `docs/INCIDENT_RESPONSE.md` for rollback and recovery controls.

## Post-launch review

Within the first operating review after launch, record:

- launch commit/tag;
- deployment evidence;
- uptime/incident summary;
- client validation;
- support volume;
- conversion/demo activity;
- defects;
- backup state;
- monitoring alerts;
- corrective actions;
- ownership and due dates.

Do not close launch follow-up until every material item has an owner.
