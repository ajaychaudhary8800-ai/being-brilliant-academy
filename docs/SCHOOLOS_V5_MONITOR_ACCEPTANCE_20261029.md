# V5 monitor acceptance — HOLD

Candidate remains c8c80151b6f0919552d60c5cb71af1b92d319ff5. New support scripts do not imply application deployment.

## Prepared

Run `python3 scripts/schoolos_v5_monitor.py` on a trusted Linux monitor host. Exit 0 means all three observations passed; exit 1 means failure. Unit validation: `python3 -m unittest discover -s scripts -p test_schoolos_v5_monitor.py` (eight PASS locally). The probe uses no credentials, accepts only the fixed V5 origin/paths, refuses redirects, validates TLS and health JSON, applies an 8s limit and 25s process wall timeout. Errors omit response bodies and exception messages. No retry hides an initial failure.

## Observations, 29 Oct

Assistant egress: homepage/ready/operational HTTP 200 at 8.999/8.935/8.970s, policy FAIL. Follow-up curl readiness HTTP 200, total 5.956022s, TLS complete 5.624046s. This execution path may include a proxy. The observations do not prove origin failure or incident #240 root cause. VPS comparison pending. Retain both failed and later healthy observations.

## Activation requirements

No schedule or notification is active from this PR. Existing candidate uptime workflow excludes V5 and GitHub draft-branch schedules do not run as default-branch schedules. Do not modify main merely to activate this probe.

Use an authorized off-host scheduler so VPS loss cannot suppress checks. Select an accountable monitor owner and exact alert destination with authorization to send test/failure/recovery notifications. Persist each state transition, notify on initial failure, deduplicate repeats with periodic escalation, and report recovery without closing unresolved root-cause issue #240. Preserve last-run/last-success timestamps and detect missed executions. Proposed interval: 5 minutes, subject to operations acceptance.

Verify alert routing using a separate synthetic failure test in the monitor platform, never by interrupting the real application or weakening TLS. Record received/acknowledged alert, actual recipient, UTC time, test reference and recovery notification. A healthy probe alone does not close monitoring readiness. Same-host probes are useful diagnostics but cannot independently prove external availability.

Outstanding: same-VPS timings, active off-host scheduler, authorized alert recipient and receipt, primary/backup ownership, #240 root-cause evidence or accountable residual-risk disposition. All formal gates remain HOLD.
